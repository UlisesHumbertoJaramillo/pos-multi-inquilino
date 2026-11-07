// Informe diario por sucursal y fecha de jornada (T-237; RF-109, D-91): el AS ve el de sus
// sucursales y el AC el de cualquiera. Lo calcula el backend.
import { Alert, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { formatMoney } from '../../api/catalog';
import { reportsApi } from '../../api/reports';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';
import { useReportBranches } from './reportBranches';
import {
  cashCountRows,
  Metric,
  MetricRow,
  methodRows,
  sellerRows,
  SimpleTable,
} from './ReportTables';

const time = (iso: string | null) =>
  iso === null
    ? 'abierto'
    : new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

export function DailyReportPage() {
  const { request } = useAuth();
  const api = useMemo(() => reportsApi(request), [request]);
  const { branches, error: branchesError } = useReportBranches();
  const [branch, setBranch] = useState<string | null>(null);
  const [day, setDay] = useState('');
  const branchId = branch ?? branches[0]?.id ?? null;

  const fetchReport = useCallback(
    () => (branchId === null ? Promise.resolve(null) : api.daily(branchId, day || null)),
    [api, branchId, day],
  );
  const loaded = useLoader(fetchReport, 'No se pudo cargar el informe.');
  const r = loaded.data;

  return (
    <AppShell>
      <PageSection title="Informe diario">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            size="small"
            label="Sucursal"
            value={branchId ?? ''}
            onChange={(e) => {
              setBranch(e.target.value);
            }}
            sx={{ minWidth: 220 }}
          >
            {branches.map((b) => (
              <MenuItem key={b.id} value={b.id}>
                {b.nombre}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="date"
            label="Fecha de jornada"
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
            }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>
        {(loaded.error ?? branchesError) !== null && (
          <Alert severity="error">{loaded.error ?? branchesError}</Alert>
        )}
        {r && (
          <Stack spacing={3} aria-label="Informe">
            <Typography variant="body2" color="text.secondary">
              {r.sucursal.nombre} · jornada del {r.fechaJornada}. Las ventas hechas después de
              medianoche en una jornada abierta antes cuentan en esa jornada.
            </Typography>
            <MetricRow>
              <Metric label="Ventas (brutas)" value={formatMoney(r.ventas.total)} />
              <Metric label="Tickets" value={String(r.ventas.tickets)} />
              <Metric label="Ticket promedio" value={formatMoney(r.ventas.promedio)} />
              <Metric
                label="Devoluciones"
                value={formatMoney(r.devoluciones.valor)}
                hint={`${String(r.devoluciones.cantidad)} · reintegrado ${formatMoney(r.devoluciones.reintegro)}`}
              />
              <Metric
                label="Anulaciones"
                value={formatMoney(r.anulaciones.total)}
                hint={`${String(r.anulaciones.cantidad)} ventas`}
              />
              {r.comprobantesSinRegularizar !== null && (
                <Metric
                  label="Comprobantes sin regularizar"
                  value={String(r.comprobantesSinRegularizar)}
                />
              )}
            </MetricRow>
            <SimpleTable
              label="Por medio de pago"
              headers={['Medio', 'Monto', 'Recargo']}
              rows={methodRows(r.porMedio)}
              empty="Sin pagos en la jornada."
            />
            <SimpleTable
              label="Por vendedor"
              headers={['Vendedor', 'Tickets', 'Total']}
              rows={sellerRows(r.porVendedor)}
              empty="Sin ventas en la jornada."
            />
            <SimpleTable
              label="Por caja y turno"
              headers={['Caja', 'Vendedor', 'Horario', 'Tickets', 'Total', 'Arqueo']}
              rows={r.porTurno.map((t) => [
                t.caja,
                t.vendedor,
                `${time(t.abiertoEn)} – ${time(t.cerradoEn)}`,
                String(t.tickets),
                formatMoney(t.total),
                t.resultado === null
                  ? '—'
                  : t.resultado === 'cuadrado'
                    ? 'Cuadrado'
                    : `${t.resultado === 'faltante' ? 'Faltante' : 'Sobrante'} ${formatMoney(t.diferencia)}`,
              ])}
              empty="No hubo turnos en la jornada."
            />
            <SimpleTable
              label="Arqueos con diferencia"
              headers={['Caja', 'Corte', 'Jornada', 'Resultado', 'Diferencia']}
              rows={cashCountRows(r.arqueos)}
              empty="Todos los arqueos cuadraron."
            />
          </Stack>
        )}
      </PageSection>
    </AppShell>
  );
}
