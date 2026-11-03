// Cuotas de descuento de los VO de una sucursal (T-128; RF-064). El control contra el tope y el
// ajuste del saldo del día los hace el backend.
import type { SellerQuota } from '@pos/contracts';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
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
import { inventoryApi } from '../../api/inventory';
import { formatPercent, quotasApi } from '../../api/quotas';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';
import { BranchSelect, useOwnBranches } from '../inventory/BranchSelect';

interface QuotaForm {
  seller: SellerQuota;
  percent: string;
  amount: string;
}

export function SellerQuotasPage() {
  const { request, user } = useAuth();
  const api = useMemo(() => quotasApi(request), [request]);
  const branches = useOwnBranches(useMemo(() => inventoryApi(request), [request]));
  const [selected, setSelected] = useState<string | null>(null);
  const branchId = selected ?? branches.own[0]?.id ?? null;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<QuotaForm | null>(null);

  const fetchData = useCallback(
    async () => (branchId === null ? null : api.listSellerQuotas(branchId)),
    [api, branchId],
  );
  const loaded = useLoader(fetchData, 'No se pudieron cargar las cuotas.');
  const data = loaded.data;

  async function save() {
    if (!form || branchId === null) return;
    setError(null);
    setNotice(null);
    try {
      await api.setSellerQuota(branchId, form.seller.usuarioId, {
        porcentajeMaximo: form.percent,
        monto: form.amount,
      });
      setNotice(`Cuota de ${form.seller.nombre} guardada.`);
      setForm(null);
      loaded.reload();
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo guardar la cuota.'));
    }
  }

  return (
    <AppShell>
      <PageSection
        title="Cuotas de descuento"
        actions={
          <BranchSelect
            branches={branches.own}
            value={branchId}
            onChange={(id) => {
              setSelected(id);
              setNotice(null);
            }}
          />
        }
      >
        {form === null && (error ?? loaded.error ?? branches.error) !== null && (
          <Alert severity="error">{error ?? loaded.error ?? branches.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}
        {data && (
          <Typography variant="body2" color="text.secondary">
            Tope del comercio: {formatPercent(data.tope.porcentajeMaximo)} por venta y{' '}
            {formatMoney(data.tope.montoMaximo)} por día. El saldo se restablece con el primer turno
            de cada fecha de jornada.
          </Typography>
        )}
        <TableContainer>
          <Table size="small" aria-label="Cuotas de los vendedores">
            <TableHead>
              <TableRow>
                <TableCell>Vendedor</TableCell>
                <TableCell align="right">Por venta</TableCell>
                <TableCell align="right">Monto por día</TableCell>
                <TableCell align="right">Saldo</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.vendedores.map((v) => (
                <TableRow key={v.usuarioId}>
                  <TableCell>
                    {v.nombre}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {v.email}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {v.asignada ? (
                      formatPercent(v.porcentajeMaximo)
                    ) : (
                      <Chip size="small" label="Sin cuota" />
                    )}
                  </TableCell>
                  <TableCell align="right">{v.asignada ? formatMoney(v.monto) : '—'}</TableCell>
                  <TableCell align="right">
                    {v.saldo === null
                      ? '—'
                      : `${formatMoney(v.saldo.saldo)} (${new Date(`${v.saldo.fechaJornada}T12:00:00`).toLocaleDateString('es-AR')})`}
                  </TableCell>
                  <TableCell align="right">
                    {/* El backend rechaza que un AS se asigne su propia cuota (D-74). */}
                    {v.usuarioId !== user?.id && (
                      <Button
                        size="small"
                        onClick={() => {
                          setForm({
                            seller: v,
                            percent: String(Number(v.porcentajeMaximo)),
                            amount: v.monto,
                          });
                        }}
                      >
                        Asignar cuota
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {data?.vendedores.length === 0 && (
          <Typography variant="body2">La sucursal no tiene vendedores activos.</Typography>
        )}
      </PageSection>

      <Dialog
        open={form !== null}
        onClose={() => {
          setForm(null);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Cuota de {form?.seller.nombre}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error !== null && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Porcentaje máximo por venta"
              value={form?.percent ?? ''}
              onChange={(e) => {
                if (form) setForm({ ...form, percent: e.target.value });
              }}
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              helperText={data ? `Hasta ${formatPercent(data.tope.porcentajeMaximo)}` : undefined}
            />
            <TextField
              label="Monto por día"
              value={form?.amount ?? ''}
              onChange={(e) => {
                if (form) setForm({ ...form, amount: e.target.value });
              }}
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              helperText={data ? `Hasta ${formatMoney(data.tope.montoMaximo)}` : undefined}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setForm(null);
            }}
          >
            Cancelar
          </Button>
          <Button variant="contained" onClick={() => void save()}>
            Guardar
          </Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
