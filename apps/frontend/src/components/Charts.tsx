// Indicadores y gráficas del primer nivel de los dashboards (T-286; RF-186, D-97, AD-29). Las cifras,
// las comparaciones y las series las calcula el backend: acá solo se dibujan, con los colores del
// tema. Cada gráfica lleva su texto alternativo y abre el detalle al elegir una barra (RF-187).
import ArrowDownwardOutlined from '@mui/icons-material/ArrowDownwardOutlined';
import ArrowUpwardOutlined from '@mui/icons-material/ArrowUpwardOutlined';
import { Box, ButtonBase, Paper, Stack, Typography, useTheme } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { formatMoney } from '../api/catalog';
import { glassSurface } from '../theme';

// Variación con su signo y su sentido: subir es correcto, bajar pide atención.
function Change({ value }: { value: string | null }) {
  if (value === null) {
    return (
      <Typography variant="body2" color="text.secondary">
        Sin ventas en el período anterior
      </Typography>
    );
  }
  const number = Number(value);
  const up = number >= 0;
  const text = `${up ? '+' : '−'}${Math.abs(number).toLocaleString('es-AR', { minimumFractionDigits: 1 })} %`;
  return (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{ alignItems: 'center', color: up ? 'success.main' : 'warning.main' }}
    >
      {up ? (
        <ArrowUpwardOutlined fontSize="small" aria-hidden />
      ) : (
        <ArrowDownwardOutlined fontSize="small" aria-hidden />
      )}
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {text}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        contra el período anterior
      </Typography>
    </Stack>
  );
}

export function Kpi({
  label,
  value,
  change,
  onSelect,
}: {
  label: string;
  value: string;
  // Sin comparación (por ejemplo, en el informe de una jornada) no se muestra la variación.
  change?: string | null;
  onSelect?: () => void;
}) {
  const content = (
    <Stack spacing={0.5} sx={{ alignItems: 'flex-start', textAlign: 'left' }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontSize: '2rem', fontWeight: 700, lineHeight: 1.15 }}>{value}</Typography>
      {change !== undefined && <Change value={change} />}
    </Stack>
  );
  return (
    <Paper
      elevation={0}
      sx={(t) => ({ ...glassSurface(t), flex: '1 1 220px', minWidth: 220, overflow: 'hidden' })}
    >
      {onSelect ? (
        <ButtonBase
          onClick={onSelect}
          aria-label={`${label}: ${value}. Ver el detalle`}
          sx={{ display: 'block', width: '100%', p: 2.5 }}
        >
          {content}
        </ButtonBase>
      ) : (
        <Box sx={{ p: 2.5 }}>{content}</Box>
      )}
    </Paper>
  );
}

export interface ChartPoint {
  label: string;
  value: number;
}

// Gráfica de barras con los colores del tema. «horizontal» para nombres largos (productos, medios).
export function BarsChart({
  title,
  points,
  horizontal = false,
  money = true,
  height = 240,
  onSelect,
}: {
  title: string;
  points: ChartPoint[];
  horizontal?: boolean;
  money?: boolean;
  height?: number;
  onSelect?: (index: number) => void;
}) {
  const theme = useTheme();
  const format = (v: number | null) =>
    v === null ? '' : money ? formatMoney(v.toFixed(2)) : v.toLocaleString('es-AR');
  const summary =
    points.length === 0
      ? 'Sin datos en el período.'
      : points.map((p) => `${p.label}: ${format(p.value)}`).join('; ');
  const band = { scaleType: 'band' as const, data: points.map((p) => p.label) };
  const linear = { valueFormatter: format };
  return (
    <Box component="figure" sx={{ m: 0, position: 'relative', minWidth: 0 }} aria-label={title}>
      <Typography component="figcaption" variant="subtitle1" sx={{ mb: 1 }}>
        {title}
      </Typography>
      {points.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Sin datos en el período.
        </Typography>
      ) : (
        <BarChart
          height={height}
          layout={horizontal ? 'horizontal' : 'vertical'}
          {...(horizontal
            ? { yAxis: [{ ...band, width: 140 }], xAxis: [linear] }
            : { xAxis: [band], yAxis: [{ ...linear, width: 80 }] })}
          series={[
            {
              data: points.map((p) => p.value),
              valueFormatter: format,
              // La variable del tema: cambia con el modo claro u oscuro.
              color: (theme.vars ?? theme).palette.primary.main,
            },
          ]}
          {...(onSelect
            ? {
                onItemClick: (_event: unknown, item: { dataIndex?: number }) => {
                  if (item.dataIndex !== undefined) onSelect(item.dataIndex);
                },
              }
            : {})}
          hideLegend
          borderRadius={6}
          margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
        />
      )}
      {/* Texto alternativo de la gráfica, para lectores de pantalla. */}
      <Box
        component="p"
        sx={{
          // En sx, 1 es el 100 %: el tamaño va en píxeles para que no ocupe lugar.
          position: 'absolute',
          width: '1px',
          height: '1px',
          m: 0,
          p: 0,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
        }}
      >
        {summary}
      </Box>
    </Box>
  );
}
