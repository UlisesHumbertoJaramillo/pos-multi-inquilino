// Atajos del POS del comercio (T-279; RF-185, D-94): el AC elige la tecla de cada acción o la deja
// sin atajo, y puede volver a la distribución por defecto. Qué teclas se permiten y si un cambio es
// válido lo decide el backend: esta pantalla muestra sus opciones y sus rechazos.
import type { Shortcuts } from '@pos/contracts';
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
import { useCallback, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { AppShell } from '../../components/AppShell';
import { errorMessage, PageSection } from '../../components/PageSection';
import { Status } from '../../components/Status';
import { useLoader } from '../../hooks/useLoader';
import { Kbd } from '../../shortcuts/ShortcutHint';
import { keyLabel } from '../../shortcuts/keys';

const NONE = '';

export function ShortcutsPage() {
  const { request } = useAuth();
  const fetchShortcuts = useCallback(() => request<Shortcuts>('/organizacion/atajos'), [request]);
  const loaded = useLoader(fetchShortcuts, 'No se pudieron cargar los atajos.');
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const data = loaded.data;

  const valueOf = (action: string, saved: string | null) => draft?.[action] ?? saved ?? NONE;

  async function save(path: string, init: RequestInit, done: string) {
    setError(null);
    setNotice(null);
    try {
      await request<Shortcuts>(path, init);
      setDraft(null);
      setNotice(done);
      loaded.reload();
    } catch (e: unknown) {
      setError(errorMessage(e, 'No se pudieron guardar los atajos.'));
    }
  }

  return (
    <AppShell>
      <PageSection
        title="Atajos del POS"
        actions={
          data &&
          (data.porDefecto ? (
            <Status severity="informativa" label="Distribución por defecto" />
          ) : (
            <Status severity="advertencia" label="Distribución propia del comercio" />
          ))
        }
      >
        <Typography color="text.secondary">
          La distribución por defecto se usa con la mano derecha sobre el teclado numérico. Si los
          equipos del comercio no lo tienen, elegí otras teclas o dejá una acción sin atajo: se
          sigue usando con su botón.
        </Typography>
        {(error ?? loaded.error) !== null && (
          <Alert severity="error">{error ?? loaded.error}</Alert>
        )}
        {notice !== null && <Alert severity="success">{notice}</Alert>}
        {data && (
          <TableContainer>
            <Table size="small" aria-label="Atajos del POS">
              <TableHead>
                <TableRow>
                  <TableCell>Acción</TableCell>
                  <TableCell>Tecla</TableCell>
                  <TableCell>Por defecto</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.atajos.map((a) => (
                  <TableRow key={a.accion}>
                    <TableCell>{a.nombre}</TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        label={`Tecla de ${a.nombre}`}
                        value={valueOf(a.accion, a.tecla)}
                        onChange={(e) => {
                          setDraft({ ...(draft ?? {}), [a.accion]: e.target.value });
                        }}
                        sx={{ minWidth: 160 }}
                      >
                        <MenuItem value={NONE}>Sin atajo</MenuItem>
                        {data.teclasPermitidas.map((key) => (
                          <MenuItem key={key} value={key}>
                            {keyLabel(key)}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                    <TableCell>
                      <Kbd>{keyLabel(a.teclaPorDefecto)}</Kbd>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button
            disabled={!data || data.porDefecto}
            onClick={() =>
              void save(
                '/organizacion/atajos/restablecimiento',
                { method: 'POST' },
                'Se volvió a la distribución por defecto.',
              )
            }
          >
            Volver a los de por defecto
          </Button>
          <Button
            variant="contained"
            disabled={draft === null}
            onClick={() => {
              if (!data || draft === null) return;
              const atajos = Object.fromEntries(
                data.atajos.map((a) => {
                  const value = valueOf(a.accion, a.tecla);
                  return [a.accion, value === NONE ? null : value];
                }),
              );
              void save(
                '/organizacion/atajos',
                { method: 'PUT', body: JSON.stringify({ atajos }) },
                'Atajos guardados. Los POS los usan al volver a cargar la pantalla.',
              );
            }}
          >
            Guardar
          </Button>
        </Stack>
      </PageSection>
    </AppShell>
  );
}
