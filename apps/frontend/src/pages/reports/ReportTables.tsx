// Tablas compartidas por el dashboard y el informe diario. Solo muestran lo que calcula el backend.
import type { ReportCashCount, ReportMethodTotal, ReportSellerTotal } from '@pos/contracts';
import {
  Box,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import type { ReactNode } from 'react';
import { formatMoney } from '../../api/catalog';

export function MetricRow({ children }: { children: ReactNode }) {
  return (
    <Stack direction="row" useFlexGap spacing={2} sx={{ flexWrap: 'wrap' }}>
      {children}
    </Stack>
  );
}

export function SimpleTable({
  label,
  headers,
  rows,
  empty,
}: {
  label: string;
  headers: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        {label}
      </Typography>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {empty}
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small" aria-label={label}>
            <TableHead>
              <TableRow>
                {headers.map((h, i) => (
                  <TableCell key={h} align={i === 0 ? 'left' : 'right'}>
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row, r) => (
                <TableRow key={r}>
                  {row.map((cell, i) => (
                    <TableCell key={i} align={i === 0 ? 'left' : 'right'}>
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

export const methodRows = (list: ReportMethodTotal[]) =>
  list.map((m) => [
    m.metodo,
    formatMoney(m.monto),
    Number(m.recargo) > 0 ? formatMoney(m.recargo) : '—',
  ]);

export const sellerRows = (list: ReportSellerTotal[]) =>
  list.map((s) => [s.vendedor, String(s.tickets), formatMoney(s.total)]);

export const cashCountRows = (list: ReportCashCount[]) =>
  list.map((c) => [
    `${c.caja}${c.vendedor ? ` · ${c.vendedor}` : ''}`,
    c.tipo === 'turno' ? 'Corte X' : 'Corte Z',
    c.fechaJornada,
    c.resultado === 'faltante' ? 'Faltante' : 'Sobrante',
    formatMoney(c.diferencia),
  ]);
