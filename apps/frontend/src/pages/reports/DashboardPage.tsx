// Dashboard del AC y del AS (T-237; RF-110, RF-111, D-50, D-91). El AC ve todo el comercio o una
// sucursal; el AS, solo sus sucursales. Las cifras las calcula el backend: las ventas son brutas,
// y las devoluciones y anulaciones se muestran aparte.
import type { Dashboard } from '@pos/contracts';
import { Alert, Box, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { formatMoney } from '../../api/catalog';
import { reportsApi } from '../../api/reports';
import { formatQuantity } from '../../api/sales';
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

const ALL = '';

export function DashboardPage() {
  const { request, user } = useAuth();
  const api = useMemo(() => reportsApi(request), [request]);
  const isAc = user?.rolActivo === 'AC';
  const { branches, error: branchesError } = useReportBranches();
  const [branch, setBranch] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // El AS siempre mira una de sus sucursales; el AC puede mirar todo el comercio.
  const branchId = branch ?? (isAc ? ALL : (branches[0]?.id ?? null));

  const fetchDashboard = useCallback(async (): Promise<Dashboard | null> => {
    if (branchId === null) return null;
    const period = { desde: from || null, hasta: to || null };
    if (isAc && branchId === ALL) return api.dashboard(period);
    if (isAc) return api.dashboard({ ...period, sucursalId: branchId });
    return api.branchDashboard(branchId, period);
  }, [api, branchId, from, to, isAc]);
  const loaded = useLoader(fetchDashboard, 'No se pudo cargar el dashboard.');
  const d = loaded.data;

  return (
    <AppShell>
      <PageSection title="Dashboard">
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
            {isAc && <MenuItem value={ALL}>Todas las sucursales</MenuItem>}
            {branches.map((b) => (
              <MenuItem key={b.id} value={b.id}>
                {b.nombre}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="date"
            label="Desde"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
            }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            type="date"
            label="Hasta"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
            }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>
        {(loaded.error ?? branchesError) !== null && (
          <Alert severity="error">{loaded.error ?? branchesError}</Alert>
        )}
        {d && <DashboardBody data={d} />}
      </PageSection>
    </AppShell>
  );
}

function DashboardBody({ data: d }: { data: Dashboard }) {
  const maxDay = Math.max(1, ...d.porDia.map((x) => Number(x.total)));
  return (
    <Stack spacing={3} aria-label="Métricas">
      <Typography variant="body2" color="text.secondary">
        Período por fecha de jornada: {d.desde} al {d.hasta}.
      </Typography>
      <MetricRow>
        <Metric label="Ventas (brutas)" value={formatMoney(d.ventas.total)} />
        <Metric label="Tickets" value={String(d.ventas.tickets)} />
        <Metric label="Ticket promedio" value={formatMoney(d.ventas.promedio)} />
        <Metric
          label="Devoluciones"
          value={formatMoney(d.devoluciones.valor)}
          hint={`${String(d.devoluciones.cantidad)} · reintegrado ${formatMoney(d.devoluciones.reintegro)}`}
        />
        <Metric
          label="Anulaciones"
          value={formatMoney(d.anulaciones.total)}
          hint={`${String(d.anulaciones.cantidad)} ventas`}
        />
        <Metric
          label="Alertas pendientes"
          value={String(d.alertas.criticas + d.alertas.advertencias + d.alertas.informativas)}
          hint={`${String(d.alertas.criticas)} críticas`}
        />
        {d.comprobantesSinRegularizar !== null && (
          <Metric
            label="Comprobantes sin regularizar"
            value={String(d.comprobantesSinRegularizar)}
          />
        )}
      </MetricRow>

      <Box aria-label="Ventas por día">
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Ventas por día
        </Typography>
        {d.porDia.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Sin ventas en el período.
          </Typography>
        ) : (
          <Stack spacing={0.5}>
            {d.porDia.map((x) => (
              <Stack key={x.fecha} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="caption" sx={{ width: 90 }}>
                  {x.fecha}
                </Typography>
                <Box
                  sx={{
                    height: 14,
                    borderRadius: 1,
                    bgcolor: 'primary.main',
                    width: `${String(Math.max(2, (Number(x.total) / maxDay) * 100))}%`,
                    maxWidth: 'calc(100% - 220px)',
                  }}
                />
                <Typography variant="caption">
                  {formatMoney(x.total)} · {String(x.tickets)}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </Box>

      <SimpleTable
        label="Ventas por medio de pago"
        headers={['Medio', 'Monto', 'Recargo']}
        rows={methodRows(d.porMedio)}
        empty="Sin pagos en el período."
      />
      <SimpleTable
        label="Ventas por vendedor"
        headers={['Vendedor', 'Tickets', 'Total']}
        rows={sellerRows(d.porVendedor)}
        empty="Sin ventas en el período."
      />
      <SimpleTable
        label="Productos más vendidos"
        headers={['Producto', 'Cantidad', 'Total']}
        rows={d.porProducto.map((p) => [
          p.nombre,
          formatQuantity(p.cantidad),
          formatMoney(p.total),
        ])}
        empty="Sin ventas en el período."
      />
      <SimpleTable
        label="Arqueos con diferencia"
        headers={['Caja', 'Corte', 'Jornada', 'Resultado', 'Diferencia']}
        rows={cashCountRows(d.arqueos)}
        empty="Todos los arqueos del período cuadraron."
      />
      <SimpleTable
        label="Productos bajo el stock mínimo"
        headers={['Producto', 'Sucursal', 'Disponible', 'Mínimo']}
        rows={d.bajoMinimo.map((b) => [
          b.producto,
          b.sucursal,
          formatQuantity(b.disponible),
          formatQuantity(b.umbral),
        ])}
        empty="Ningún producto está por debajo del mínimo."
      />
    </Stack>
  );
}
