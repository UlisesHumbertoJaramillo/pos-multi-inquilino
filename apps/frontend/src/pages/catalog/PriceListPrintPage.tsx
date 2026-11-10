// Vista imprimible de una lista de precios (T-083; RF-033): sin menú ni paneles, en blanco y
// negro, agrupada por categoría. Al imprimir se ocultan los botones.
import type { PriceSheet } from '@pos/contracts';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useCallback, useMemo } from 'react';
import { useParams } from 'react-router';
import { catalogApi, formatMoney } from '../../api/catalog';
import { useAuth } from '../../auth/AuthContext';
import { useLoader } from '../../hooks/useLoader';
import { describeRule } from './PriceListsPage';
import { PRINT } from '../../theme';

type Row = PriceSheet['precios'][number];

export function PriceListPrintPage() {
  const { id = '' } = useParams();
  const { request } = useAuth();
  const api = useMemo(() => catalogApi(request), [request]);
  const fetchSheet = useCallback(() => api.getPriceSheet(id), [api, id]);
  const loaded = useLoader(fetchSheet, 'No se pudo cargar la lista de precios.');
  const sheet = loaded.data;

  // Las filas ya llegan ordenadas por categoría y nombre.
  const groups = new Map<string, Row[]>();
  for (const row of sheet?.precios ?? []) {
    const group = row.categoria ?? 'Combos';
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }

  return (
    <Box
      sx={{
        bgcolor: PRINT.paper,
        color: PRINT.ink,
        minHeight: '100vh',
        p: { xs: 2, sm: 4 },
        '@media print': { p: 0 },
        '& table': { width: '100%', borderCollapse: 'collapse', mb: 3 },
        '& th, & td': {
          borderBottom: `1px solid ${PRINT.rule}`,
          py: 0.75,
          px: 1,
          textAlign: 'left',
        },
        '& td.precio, & th.precio': { textAlign: 'right', whiteSpace: 'nowrap' },
      }}
    >
      {loaded.error !== null && <Alert severity="error">{loaded.error}</Alert>}
      {sheet && (
        <>
          <Stack
            direction="row"
            sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 3, gap: 2 }}
          >
            <Box>
              <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
                Lista de precios: {sheet.lista.nombre}
              </Typography>
              <Typography variant="body2">
                {describeRule(sheet.lista.regla)} · Precios finales con IVA incluido ·{' '}
                {new Date().toLocaleDateString('es-AR')}
              </Typography>
            </Box>
            <Button
              variant="contained"
              onClick={() => {
                window.print();
              }}
              sx={{ '@media print': { display: 'none' } }}
            >
              Imprimir
            </Button>
          </Stack>
          {[...groups.entries()].map(([group, rows]) => (
            <Box key={group} component="section" sx={{ breakInside: 'avoid' }}>
              <Typography variant="h6" component="h2">
                {group}
              </Typography>
              <table aria-label={`Precios de ${group}`}>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Código</th>
                    <th className="precio">Precio</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.productoId}>
                      <td>{row.nombre}</td>
                      <td>{row.codigoBarras ?? '—'}</td>
                      <td className="precio">{formatMoney(row.precioFinal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
}
