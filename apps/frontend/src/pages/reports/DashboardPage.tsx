// Dashboard del AC y del AS (T-237; RF-110, RF-111, D-50, D-91). El AC ve todo el comercio o una
// sucursal; el AS, solo sus sucursales. Las cifras las calcula el backend: las ventas son brutas,
// y las devoluciones y anulaciones se muestran aparte. Dos niveles (T-287 a T-289; RF-186, RF-187):
// primero los indicadores, lo que requiere atención y las gráficas; después, el detalle completo.
import type { Dashboard } from '@pos/contracts';
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { formatMoney } from '../../api/catalog';
import { reportsApi } from '../../api/reports';
import { formatQuantity } from '../../api/sales';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { AttentionCard } from '../../components/AttentionCard';
import { BarsChart, Kpi } from '../../components/Charts';
import { DetailPanel } from '../../components/DetailPanel';
import { PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';
import { useReportBranches } from './reportBranches';
import { cashCountRows, MetricRow, methodRows, sellerRows, SimpleTable } from './ReportTables';

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
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
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

// Detalle de segundo nivel que se abre desde un indicador, una gráfica o un punto de atención.
type Section = 'ventas' | 'medios' | 'productos' | 'vendedores' | 'arqueos' | 'stock' | 'todo';

const SECTION_TITLES: Record<Section, string> = {
  ventas: 'Ventas del período',
  medios: 'Ventas por medio de pago',
  productos: 'Productos más vendidos',
  vendedores: 'Ventas por vendedor',
  arqueos: 'Arqueos con diferencia',
  stock: 'Productos bajo el stock mínimo',
  todo: 'Todos los datos del período',
};

// Fecha legible (12/11/2026) a partir de AAAA-MM-DD.
const longDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

// Primer nivel (RF-186, D-97): indicadores comparados, lo que requiere atención y las gráficas.
// Segundo nivel (RF-187): las tablas completas, en un panel, sin dejar la pantalla.
function DashboardBody({ data: d }: { data: Dashboard }) {
  const [section, setSection] = useState<Section | null>(null);
  const open = (s: Section) => () => {
    setSection(s);
  };
  const a = d.atencion;
  return (
    <Stack spacing={3} aria-label="Métricas">
      <Typography variant="body2" color="text.secondary">
        Del {longDay(d.desde)} al {longDay(d.hasta)}, por fecha de jornada. Se compara con el{' '}
        {longDay(d.anterior.desde)} al {longDay(d.anterior.hasta)}.
      </Typography>
      <MetricRow>
        <Kpi
          label="Ventas (brutas)"
          value={formatMoney(d.ventas.total)}
          change={d.variacion.total}
          onSelect={open('ventas')}
        />
        <Kpi
          label="Tickets"
          value={String(d.ventas.tickets)}
          change={d.variacion.tickets}
          onSelect={open('ventas')}
        />
        <Kpi
          label="Ticket promedio"
          value={formatMoney(d.ventas.promedio)}
          change={d.variacion.promedio}
          onSelect={open('vendedores')}
        />
      </MetricRow>

      {(a.arqueosConDiferencia > 0 ||
        a.bajoMinimo > 0 ||
        (a.comprobantesSinRegularizar ?? 0) > 0) && (
        <Stack spacing={1} aria-label="Necesita atención">
          {(a.comprobantesSinRegularizar ?? 0) > 0 && (
            <AttentionCard
              severity="critica"
              title={`${String(a.comprobantesSinRegularizar)} comprobantes sin regularizar`}
              detail="Revisalos en Comprobantes antes de que venza el plazo."
            />
          )}
          {a.arqueosConDiferencia > 0 && (
            <AttentionCard
              severity="advertencia"
              title={`${String(a.arqueosConDiferencia)} arqueos con diferencia en el período`}
              action={{ label: 'Ver los arqueos', onClick: open('arqueos') }}
            />
          )}
          {a.bajoMinimo > 0 && (
            <AttentionCard
              severity="advertencia"
              title={`${String(a.bajoMinimo)} productos bajo el stock mínimo`}
              action={{ label: 'Ver los productos', onClick: open('stock') }}
            />
          )}
        </Stack>
      )}

      <BarsChart
        title="Ventas por día"
        points={d.serieDiaria.map((x) => ({ label: shortDay(x.fecha), value: Number(x.total) }))}
        onSelect={() => {
          setSection('ventas');
        }}
      />
      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        <BarsChart
          title="Por medio de pago"
          horizontal
          height={200}
          points={d.porMedio.map((m) => ({ label: m.metodo, value: Number(m.monto) }))}
          onSelect={() => {
            setSection('medios');
          }}
        />
        <BarsChart
          title="Los 5 más vendidos"
          horizontal
          height={200}
          points={d.masVendidos.map((p) => ({ label: p.nombre, value: Number(p.total) }))}
          onSelect={() => {
            setSection('productos');
          }}
        />
      </Box>
      <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
        <Button onClick={open('todo')}>Ver todos los datos del período</Button>
      </Stack>

      <DetailPanel
        title={section === null ? 'Detalle' : SECTION_TITLES[section]}
        open={section !== null}
        onClose={() => {
          setSection(null);
        }}
      >
        {section !== null && <DashboardDetail data={d} section={section} />}
      </DetailPanel>
    </Stack>
  );
}

function DashboardDetail({ data: d, section }: { data: Dashboard; section: Section }) {
  const show = (s: Section) => section === s || section === 'todo';
  return (
    <Stack spacing={3}>
      {show('ventas') && (
        <>
          <SimpleTable
            label="Ventas por día"
            headers={['Día', 'Tickets', 'Total']}
            rows={d.porDia.map((x) => [x.fecha, String(x.tickets), formatMoney(x.total)])}
            empty="Sin ventas en el período."
          />
          <SimpleTable
            label="Devoluciones y anulaciones"
            headers={['', 'Cantidad', 'Valor', 'Reintegrado']}
            rows={[
              [
                'Devoluciones',
                String(d.devoluciones.cantidad),
                formatMoney(d.devoluciones.valor),
                formatMoney(d.devoluciones.reintegro),
              ],
              [
                'Anulaciones',
                String(d.anulaciones.cantidad),
                formatMoney(d.anulaciones.total),
                formatMoney(d.anulaciones.reintegro),
              ],
            ]}
            empty=""
          />
          <Typography variant="body2" color="text.secondary">
            Período anterior: {formatMoney(d.anterior.ventas.total)} en{' '}
            {String(d.anterior.ventas.tickets)} tickets. Alertas pendientes:{' '}
            {String(d.alertas.criticas + d.alertas.advertencias + d.alertas.informativas)}.
          </Typography>
        </>
      )}
      {show('medios') && (
        <SimpleTable
          label="Ventas por medio de pago"
          headers={['Medio', 'Monto', 'Recargo']}
          rows={methodRows(d.porMedio)}
          empty="Sin pagos en el período."
        />
      )}
      {show('vendedores') && (
        <SimpleTable
          label="Ventas por vendedor"
          headers={['Vendedor', 'Tickets', 'Total']}
          rows={sellerRows(d.porVendedor)}
          empty="Sin ventas en el período."
        />
      )}
      {show('productos') && (
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
      )}
      {show('arqueos') && (
        <SimpleTable
          label="Arqueos con diferencia"
          headers={['Caja', 'Corte', 'Jornada', 'Resultado', 'Diferencia']}
          rows={cashCountRows(d.arqueos)}
          empty="Todos los arqueos del período cuadraron."
        />
      )}
      {show('stock') && (
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
      )}
    </Stack>
  );
}
