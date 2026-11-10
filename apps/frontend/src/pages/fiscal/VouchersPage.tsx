// Comprobantes del comercio (T-211; RF-103 a RF-105, RF-168): estado, alertas fiscales, reenvío de
// un rechazado y facturación posterior. Los datos de un rechazo se corrigen en la ficha del cliente.
// Los rechazados y las alertas fiscales se muestran como puntos de atención (T-261, RF-191).
import type { Voucher } from '@pos/contracts';
import {
  Alert,
  Button,
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
import { AttentionCard } from '../../components/AttentionCard';
import { Status } from '../../components/Status';
import type { Severity } from '../../theme';
import { errorMessage, PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';

// Severidad de cada estado de un comprobante.
function voucherSeverity(v: Voucher): Severity {
  if (v.estado === 'aceptado') return 'correcta';
  if (v.estado === 'rechazado') return 'critica';
  if (v.estado === 'bloqueado' || v.contingencia || v.noFiscal) return 'advertencia';
  return 'informativa';
}

const asSeverity = (value: string): Severity =>
  value === 'critica' ? 'critica' : value === 'advertencia' ? 'advertencia' : 'informativa';

export function VouchersPage() {
  const { request } = useAuth();
  const api = useMemo(() => fiscalApi(request), [request]);
  const fetchVouchers = useCallback(() => api.vouchers(), [api]);
  const loaded = useLoader(fetchVouchers, 'No se pudieron cargar los comprobantes.');
  const [ticket, setTicket] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [onlyRejected, setOnlyRejected] = useState(false);
  const data = loaded.data;
  const rejected = data?.comprobantes.filter((v) => v.estado === 'rechazado') ?? [];
  const shown = onlyRejected ? rejected : (data?.comprobantes ?? []);

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
          <AttentionCard
            key={a.id}
            severity={asSeverity(a.severidad)}
            title={describeFiscalAlert(a.tipo, a.detalle)}
            {...(a.tipo === 'comprobante_rechazado' && rejected.length > 0
              ? {
                  action: onlyRejected
                    ? {
                        label: 'Ver todos',
                        onClick: () => {
                          setOnlyRejected(false);
                        },
                      }
                    : {
                        label: 'Ver los rechazados',
                        onClick: () => {
                          setOnlyRejected(true);
                        },
                      },
                }
              : {})}
          />
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
              {shown.map((v) => (
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
                    <Status severity={voucherSeverity(v)} label={describeVoucherState(v)} />
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
