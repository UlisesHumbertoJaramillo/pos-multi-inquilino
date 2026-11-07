// Comprobantes del comercio (T-211; RF-103 a RF-105, RF-168): estado, alertas fiscales, reenvío de
// un rechazado y facturación posterior. Los datos de un rechazo se corrigen en la ficha del cliente.
import {
  Alert,
  Button,
  Chip,
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
import { describeFiscalAlert, describeVoucherState, fiscalApi } from '../../api/fiscal';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';

export function VouchersPage() {
  const { request } = useAuth();
  const api = useMemo(() => fiscalApi(request), [request]);
  const fetchVouchers = useCallback(() => api.vouchers(), [api]);
  const loaded = useLoader(fetchVouchers, 'No se pudieron cargar los comprobantes.');
  const [ticket, setTicket] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const data = loaded.data;

  async function run(action: () => Promise<unknown>, done: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      loaded.reload();
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudo completar la operación.'));
    }
  }

  return (
    <AppShell>
      <PageSection title="Comprobantes">
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}
        {data?.alertas.map((a) => (
          <Alert key={a.id} severity={a.severidad === 'critica' ? 'error' : 'warning'}>
            {describeFiscalAlert(a.tipo, a.detalle)}
          </Alert>
        ))}
        {data && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              size="small"
              label="Número de ticket"
              value={ticket}
              onChange={(e) => {
                setTicket(e.target.value);
              }}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
            <Button
              disabled={ticket.trim() === ''}
              onClick={() =>
                void run(() => api.invoiceLater(Number(ticket)), 'Pedido de factura registrado.')
              }
            >
              Facturar ticket
            </Button>
          </Stack>
        )}
        <TableContainer>
          <Table size="small" aria-label="Comprobantes">
            <TableHead>
              <TableRow>
                <TableCell>Comprobante</TableCell>
                <TableCell>Ticket</TableCell>
                <TableCell>Comprador</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell align="right">Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.comprobantes.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    {v.clase === null
                      ? 'Sin numerar'
                      : `${v.clase} ${String(v.puntoVenta)}-${String(v.numero)}`}
                  </TableCell>
                  <TableCell>{v.numeroTicket ?? '—'}</TableCell>
                  <TableCell>{v.comprador ?? 'Consumidor final'}</TableCell>
                  <TableCell align="right">{formatMoney(v.total)}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={
                        v.estado === 'aceptado'
                          ? 'success'
                          : v.estado === 'rechazado'
                            ? 'error'
                            : 'default'
                      }
                      label={describeVoucherState(v)}
                    />
                    {v.motivoRechazo !== null && (
                      <Typography variant="caption" sx={{ display: 'block' }}>
                        {v.motivoRechazo}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {v.estado === 'rechazado' && (
                      <Button
                        size="small"
                        onClick={() => void run(() => api.resend(v.id), 'Comprobante reenviado.')}
                      >
                        Reenviar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {data?.comprobantes.length === 0 && (
          <Typography variant="body2">Todavía no hay comprobantes.</Typography>
        )}
      </PageSection>
    </AppShell>
  );
}
