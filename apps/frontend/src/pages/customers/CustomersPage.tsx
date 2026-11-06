// Clientes del comercio y su crédito (T-187; RF-072, RF-132). Se comparten en todas las sucursales.
// El disponible y las reglas de baja los decide el backend.
import type { Customer, CustomerRequest } from '@pos/contracts';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { formatMoney } from '../../api/catalog';
import { collectionsApi, FISCAL_CONDITIONS } from '../../api/collections';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';

interface DataForm {
  id: string | null;
  razonSocial: string;
  documento: string;
  condicionFiscal: CustomerRequest['condicionFiscal'];
}

interface CreditForm {
  customer: Customer;
  cuentaCorriente: boolean;
  limite: string;
}

const EMPTY: DataForm = {
  id: null,
  razonSocial: '',
  documento: '',
  condicionFiscal: 'consumidor_final',
};

export function CustomersPage() {
  const { request } = useAuth();
  const api = useMemo(() => collectionsApi(request), [request]);
  const fetchCustomers = useCallback(() => api.listCustomers(false), [api]);
  const loaded = useLoader(fetchCustomers, 'No se pudieron cargar los clientes.');
  const [data, setData] = useState<DataForm | null>(null);
  const [credit, setCredit] = useState<CreditForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, done: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      setData(null);
      setCredit(null);
      loaded.reload();
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo completar la operación.'));
    }
  }

  function saveData() {
    if (!data) return;
    const body: CustomerRequest = {
      razonSocial: data.razonSocial,
      documento: data.documento.trim() === '' ? null : data.documento,
      condicionFiscal: data.condicionFiscal,
    };
    const { id } = data;
    void run(
      () => (id === null ? api.createCustomer(body) : api.updateCustomer(id, body)),
      'Cliente guardado.',
    );
  }

  function saveCredit() {
    if (!credit) return;
    const { customer, cuentaCorriente, limite } = credit;
    void run(
      () => api.setCredit(customer.id, { cuentaCorriente, limite: limite.trim() || '0' }),
      `Crédito de ${customer.razonSocial} guardado.`,
    );
  }

  const open = data !== null || credit !== null;
  return (
    <AppShell>
      <PageSection
        title="Clientes"
        actions={
          <Button
            variant="contained"
            onClick={() => {
              setError(null);
              setData(EMPTY);
            }}
          >
            Nuevo cliente
          </Button>
        }
      >
        {!open && (error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}
        <TableContainer>
          <Table size="small" aria-label="Clientes">
            <TableHead>
              <TableRow>
                <TableCell>Cliente</TableCell>
                <TableCell>Condición fiscal</TableCell>
                <TableCell align="right">Límite</TableCell>
                <TableCell align="right">Saldo</TableCell>
                <TableCell align="right">Disponible</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loaded.data?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    {c.razonSocial}
                    {c.documento !== null && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block' }}
                      >
                        {c.documento}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{FISCAL_CONDITIONS[c.condicionFiscal]}</TableCell>
                  <TableCell align="right">
                    {c.cuentaCorriente ? (
                      formatMoney(c.limiteCredito)
                    ) : (
                      <Chip size="small" label="Sin cuenta" />
                    )}
                  </TableCell>
                  <TableCell align="right">{formatMoney(c.saldo)}</TableCell>
                  <TableCell align="right">
                    {c.cuentaCorriente ? formatMoney(c.disponible) : '—'}
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      onClick={() => {
                        setError(null);
                        setData({
                          id: c.id,
                          razonSocial: c.razonSocial,
                          documento: c.documento ?? '',
                          condicionFiscal: c.condicionFiscal,
                        });
                      }}
                    >
                      Editar
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        setError(null);
                        setCredit({
                          customer: c,
                          cuentaCorriente: c.cuentaCorriente,
                          limite: c.limiteCredito,
                        });
                      }}
                    >
                      Crédito
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      onClick={() => {
                        if (window.confirm(`¿Dar de baja a ${c.razonSocial}?`)) {
                          void run(() => api.deactivateCustomer(c.id), 'Cliente dado de baja.');
                        }
                      }}
                    >
                      Dar de baja
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {loaded.data?.length === 0 && (
          <Typography variant="body2">Todavía no hay clientes.</Typography>
        )}
      </PageSection>

      {data && (
        <Dialog
          open
          onClose={() => {
            setData(null);
          }}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>{data.id === null ? 'Nuevo cliente' : 'Editar cliente'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {error !== null && <Alert severity="error">{error}</Alert>}
              <TextField
                label="Razón social"
                value={data.razonSocial}
                onChange={(e) => {
                  setData({ ...data, razonSocial: e.target.value });
                }}
                autoFocus
              />
              <TextField
                label="Documento"
                value={data.documento}
                onChange={(e) => {
                  setData({ ...data, documento: e.target.value });
                }}
              />
              <TextField
                select
                label="Condición fiscal"
                value={data.condicionFiscal}
                onChange={(e) => {
                  setData({
                    ...data,
                    condicionFiscal: e.target.value as DataForm['condicionFiscal'],
                  });
                }}
              >
                {Object.entries(FISCAL_CONDITIONS).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setData(null);
              }}
            >
              Cancelar
            </Button>
            <Button variant="contained" onClick={saveData}>
              Guardar
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {credit && (
        <Dialog
          open
          onClose={() => {
            setCredit(null);
          }}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>Crédito de {credit.customer.razonSocial}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {error !== null && <Alert severity="error">{error}</Alert>}
              <FormControlLabel
                control={
                  <Switch
                    checked={credit.cuentaCorriente}
                    onChange={(e) => {
                      setCredit({ ...credit, cuentaCorriente: e.target.checked });
                    }}
                  />
                }
                label="Tiene cuenta corriente"
              />
              <TextField
                label="Límite de crédito"
                value={credit.limite}
                disabled={!credit.cuentaCorriente}
                onChange={(e) => {
                  setCredit({ ...credit, limite: e.target.value.replace(',', '.') });
                }}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setCredit(null);
              }}
            >
              Cancelar
            </Button>
            <Button variant="contained" onClick={saveCredit}>
              Guardar
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </AppShell>
  );
}
