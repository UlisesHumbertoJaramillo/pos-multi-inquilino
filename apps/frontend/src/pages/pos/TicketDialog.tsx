// Documento del ticket de una venta (T-232; RF-107): sucursal, vendedor, ítems con promociones,
// pagos, totales y la identificación fiscal. Lo arma el backend; la impresión llega en la Fase 15.
import type { SaleTicket } from '@pos/contracts';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { useCallback, useMemo } from 'react';
import { formatMoney } from '../../api/catalog';
import { reportsApi } from '../../api/reports';
import { formatQuantity } from '../../api/sales';
import { useAuth } from '../../auth/AuthContext';
import { useLoader } from '../../hooks/useLoader';

function Line({ left, right, strong }: { left: string; right: string; strong?: boolean }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" sx={{ fontWeight: strong ? 700 : 400 }}>
        {left}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontWeight: strong ? 700 : 400, fontVariantNumeric: 'tabular-nums' }}
      >
        {right}
      </Typography>
    </Stack>
  );
}

function TicketBody({ t }: { t: SaleTicket }) {
  return (
    <Stack spacing={1} sx={{ fontFamily: 'monospace' }} aria-label="Ticket">
      <Typography variant="subtitle1" sx={{ textAlign: 'center', fontWeight: 700 }}>
        {t.comercio.nombre}
      </Typography>
      <Typography variant="caption" sx={{ textAlign: 'center' }}>
        {t.sucursal.nombre}
        {t.sucursal.direccion ? ` · ${t.sucursal.direccion}` : ''}
        {t.comercio.cuit ? ` · CUIT ${t.comercio.cuit}` : ''}
      </Typography>
      <Typography variant="caption">
        Ticket {String(t.numeroTicket ?? '—')} · {t.caja} · {t.vendedor}
        {t.confirmadaEn ? ` · ${new Date(t.confirmadaEn).toLocaleString('es-AR')}` : ''}
      </Typography>
      {t.estado === 'anulada' && <Alert severity="warning">Venta anulada.</Alert>}
      {t.cliente && (
        <Typography variant="caption">
          Cliente: {t.cliente.nombre}
          {t.cliente.documento ? ` (${t.cliente.documento})` : ''}
        </Typography>
      )}
      <Divider />
      {t.items.map((item, i) => (
        <Stack key={i} spacing={0.25}>
          <Line
            left={`${formatQuantity(item.cantidad)} × ${item.nombre} (${formatMoney(item.precioUnitario)})`}
            right={formatMoney(item.bruto)}
          />
          {item.promocion && (
            <Line
              left={`  ${item.promocion.nombre}`}
              right={`−${formatMoney(item.promocion.descuento)}`}
            />
          )}
          {Number(item.descuentoManual) > 0 && (
            <Line left="  Descuento" right={`−${formatMoney(item.descuentoManual)}`} />
          )}
        </Stack>
      ))}
      <Divider />
      <Line left="Subtotal" right={formatMoney(t.totales.subtotal)} />
      {Number(t.totales.descuentoPromociones) > 0 && (
        <Line left="Promociones" right={`−${formatMoney(t.totales.descuentoPromociones)}`} />
      )}
      {Number(t.totales.descuentoManual) > 0 && (
        <Line left="Descuento" right={`−${formatMoney(t.totales.descuentoManual)}`} />
      )}
      <Line left="Total" right={formatMoney(t.totales.total)} strong />
      {t.pagos.map((p, i) => (
        <Line
          key={i}
          left={`${p.metodo}${Number(p.recargo) !== 0 ? ` (recargo ${formatMoney(p.recargo)})` : ''}`}
          right={formatMoney(p.monto)}
        />
      ))}
      {Number(t.totales.recargos) !== 0 && (
        <Line left="Cobrado" right={formatMoney(t.totales.cobrado)} />
      )}
      <Divider />
      {t.comprobante?.numero && (
        <Typography variant="caption">
          Factura {t.comprobante.clase ?? ''} {String(t.comprobante.puntoVenta ?? '')}-
          {t.comprobante.numero}
          {t.comprobante.cae ? ` · CAE ${t.comprobante.cae}` : ''}
          {t.comprobante.caea ? ` · CAEA ${t.comprobante.caea}` : ''}
        </Typography>
      )}
      <Typography variant="caption" sx={{ textAlign: 'center', fontWeight: 700 }}>
        {t.leyenda}
      </Typography>
    </Stack>
  );
}

export function TicketDialog({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const { request } = useAuth();
  const api = useMemo(() => reportsApi(request), [request]);
  const fetchTicket = useCallback(() => api.ticket(saleId), [api, saleId]);
  const loaded = useLoader(fetchTicket, 'No se pudo cargar el ticket.');
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Ticket</DialogTitle>
      <DialogContent>
        {loaded.error !== null && <Alert severity="error">{loaded.error}</Alert>}
        {loaded.data ? (
          <TicketBody t={loaded.data} />
        ) : (
          loaded.error === null && <CircularProgress aria-label="Cargando el ticket" />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cerrar</Button>
      </DialogActions>
    </Dialog>
  );
}
