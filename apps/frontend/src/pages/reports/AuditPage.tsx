// Auditoría comercial (T-237; RF-114): el AC ve todo su comercio y el AS solo sus sucursales. El
// ámbito lo aplica el backend; la pantalla filtra y pagina.
import type { CommercialAuditPage } from '@pos/contracts';
import {
  Alert,
  Button,
  MenuItem,
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
import { reportsApi } from '../../api/reports';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { PageSection } from '../../components/PageSection';
import { useLoader } from '../../hooks/useLoader';
import { useReportBranches } from './reportBranches';

const ALL = '';

// La fecha del filtro es local: el día completo, en la hora de este equipo.
const startOf = (day: string) => (day === '' ? null : new Date(`${day}T00:00:00`).toISOString());
const endOf = (day: string) => (day === '' ? null : new Date(`${day}T23:59:59.999`).toISOString());

const summary = (value: unknown) => {
  if (value === null || value === undefined) return '—';
  const text = JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
};

export function AuditPage() {
  const { request } = useAuth();
  const api = useMemo(() => reportsApi(request), [request]);
  const { branches, error: branchesError } = useReportBranches();
  const [branch, setBranch] = useState(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);

  const fetchAudit = useCallback(
    (): Promise<CommercialAuditPage> =>
      api.audit({
        sucursalId: branch === ALL ? null : branch,
        desde: startOf(from),
        hasta: endOf(to),
        entidad: entity.trim() || null,
        pagina: page,
      }),
    [api, branch, from, to, entity, page],
  );
  const loaded = useLoader(fetchAudit, 'No se pudo cargar la auditoría.');
  const data = loaded.data;
  const filter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <AppShell>
      <PageSection title="Auditoría comercial">
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField
            select
            size="small"
            label="Sucursal"
            value={branch}
            onChange={(e) => {
              filter(() => {
                setBranch(e.target.value);
              });
            }}
            sx={{ minWidth: 220 }}
          >
            <MenuItem value={ALL}>Todas las de mi ámbito</MenuItem>
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
              filter(() => {
                setFrom(e.target.value);
              });
            }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            type="date"
            label="Hasta"
            value={to}
            onChange={(e) => {
              filter(() => {
                setTo(e.target.value);
              });
            }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            label="Entidad"
            value={entity}
            onChange={(e) => {
              filter(() => {
                setEntity(e.target.value);
              });
            }}
            slotProps={{ htmlInput: { maxLength: 60 } }}
          />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Sin fechas: los últimos 7 días.
        </Typography>
        {(loaded.error ?? branchesError) !== null && (
          <Alert severity="error">{loaded.error ?? branchesError}</Alert>
        )}
        {data && (
          <>
            <TableContainer>
              <Table size="small" aria-label="Auditoría comercial">
                <TableHead>
                  <TableRow>
                    <TableCell>Momento</TableCell>
                    <TableCell>Usuario</TableCell>
                    <TableCell>Sucursal</TableCell>
                    <TableCell>Acción</TableCell>
                    <TableCell>Entidad</TableCell>
                    <TableCell>Después</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.entradas.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{new Date(e.momento).toLocaleString('es-AR')}</TableCell>
                      <TableCell>
                        {e.usuario ?? e.usuarioId} ({e.rolActivo})
                      </TableCell>
                      <TableCell>{e.sucursal ?? 'Comercio'}</TableCell>
                      <TableCell>{e.accion}</TableCell>
                      <TableCell>{e.entidad}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {summary(e.despues)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {data.entradas.length === 0 && (
              <Typography color="text.secondary">No hay registros con estos filtros.</Typography>
            )}
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              <Button
                disabled={page === 1}
                onClick={() => {
                  setPage((p) => p - 1);
                }}
              >
                Anterior
              </Button>
              <Typography sx={{ alignSelf: 'center' }}>Página {String(page)}</Typography>
              <Button
                disabled={!data.hayMas}
                onClick={() => {
                  setPage((p) => p + 1);
                }}
              >
                Siguiente
              </Button>
            </Stack>
          </>
        )}
      </PageSection>
    </AppShell>
  );
}
