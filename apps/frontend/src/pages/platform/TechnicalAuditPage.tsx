// Auditoría técnica de la plataforma, para el SA (T-058, RF-022). Sin contenido comercial.
import type { TechnicalAuditEntry } from '@pos/contracts';
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
} from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { platformApi } from '../../api/platform';
import { useAuth } from '../../auth/AuthContext';
import { useLoader } from '../../hooks/useLoader';
import { AppShell } from '../../components/AppShell';
import { PageSection } from '../../components/PageSection';

const dateTime = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'medium' });

export function TechnicalAuditPage() {
  const { request } = useAuth();
  const api = useMemo(() => platformApi(request), [request]);
  const [type, setType] = useState('');

  // El filtro se aplica con el botón, no en cada tecla.
  const [appliedType, setAppliedType] = useState('');
  const fetchEntries = useCallback(
    () => api.technicalAudit({ limite: 100, ...(appliedType ? { tipo: appliedType } : {}) }),
    [api, appliedType],
  );
  const loaded = useLoader(fetchEntries, 'No se pudo cargar la auditoría técnica.');
  const entries: TechnicalAuditEntry[] = loaded.data ?? [];

  return (
    <AppShell>
      <PageSection
        title="Auditoría técnica"
        actions={
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              label="Tipo de evento"
              placeholder="login_fallido"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
              }}
            />
            <Button
              variant="outlined"
              onClick={() => {
                setAppliedType(type.trim());
                loaded.reload();
              }}
            >
              Filtrar
            </Button>
          </Stack>
        }
      >
        {loaded.error !== null && <Alert severity="error">{loaded.error}</Alert>}
        <TableContainer>
          <Table size="small" aria-label="Auditoría técnica">
            <TableHead>
              <TableRow>
                <TableCell>Momento</TableCell>
                <TableCell>Evento</TableCell>
                <TableCell>Comercio</TableCell>
                <TableCell>Detalle</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{dateTime.format(new Date(entry.momento))}</TableCell>
                  <TableCell>{entry.tipoEvento}</TableCell>
                  <TableCell>{entry.comercioId ?? '—'}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {Object.entries(entry.detalle)
                      .map(([key, value]) => `${key}: ${String(value)}`)
                      .join(' · ')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </PageSection>
    </AppShell>
  );
}
