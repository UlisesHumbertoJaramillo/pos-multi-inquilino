// Panel técnico del SA: errores internos recientes, estado de los trabajos y del outbox, y
// periféricos con falla (T-058, T-241; RF-016). Sin datos comerciales.
import type { TechnicalPanel } from '@pos/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { useCallback, useMemo } from 'react';
import { platformApi } from '../../api/platform';
import { useAuth } from '../../auth/AuthContext';
import { useLoader } from '../../hooks/useLoader';
import { AppShell } from '../../components/AppShell';
import { PageSection } from '../../components/PageSection';

const REASONS: Record<string, string> = {
  sin_soporte: 'el navegador no lo admite',
  sin_permiso: 'sin permiso del navegador',
  desconectada: 'desconectada',
  error_envio: 'error al enviar',
  sin_papel: 'sin papel',
};

const dateTime = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'medium' });

function Counter({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <Card variant="outlined" sx={{ minWidth: 160 }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h4" color={alert && value > 0 ? 'error' : 'text.primary'}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}

export function PanelPage() {
  const { request } = useAuth();
  const api = useMemo(() => platformApi(request), [request]);

  const fetchPanel = useCallback(() => api.technicalPanel(), [api]);
  const loaded = useLoader<TechnicalPanel>(fetchPanel, 'No se pudo cargar el panel.');
  const panel = loaded.data;

  return (
    <AppShell>
      <PageSection
        title="Panel técnico"
        actions={<Button onClick={loaded.reload}>Actualizar</Button>}
      >
        {loaded.error !== null && <Alert severity="error">{loaded.error}</Alert>}
        {panel !== null && (
          <>
            <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
              <Counter label="Trabajos pendientes" value={panel.trabajos.pendientes} />
              <Counter label="Trabajos en curso" value={panel.trabajos.enCurso} />
              <Counter label="Trabajos fallidos" value={panel.trabajos.fallidos} alert />
              <Counter label="Eventos sin despachar" value={panel.outbox.pendientes} />
              <Counter label="Eventos con errores" value={panel.outbox.conErrores} alert />
              <Counter
                label="Periféricos con falla"
                value={panel.perifericosConFalla.length}
                alert
              />
            </Stack>
            <Typography variant="h6">Periféricos con falla</Typography>
            {panel.perifericosConFalla.length === 0 ? (
              <Typography color="text.secondary">
                Todos los periféricos informados funcionan.
              </Typography>
            ) : (
              <List dense aria-label="Periféricos con falla">
                {panel.perifericosConFalla.map((p) => (
                  <ListItem key={`${p.comercioId}-${p.dispositivo}-${p.momento}`} divider>
                    <ListItemText
                      primary={`${p.comercio}: ${p.dispositivo} (${p.conexion})${p.motivo ? ` — ${REASONS[p.motivo] ?? p.motivo}` : ''}`}
                      secondary={dateTime.format(new Date(p.momento))}
                    />
                  </ListItem>
                ))}
              </List>
            )}
            <Typography variant="h6">Errores internos recientes</Typography>
            {panel.erroresRecientes.length === 0 ? (
              <Typography color="text.secondary">Sin errores recientes.</Typography>
            ) : (
              <List dense aria-label="Errores internos recientes">
                {panel.erroresRecientes.map((item) => (
                  <ListItem key={`${item.momento}-${item.ruta}`} divider>
                    <ListItemText
                      primary={`${item.metodo} ${item.ruta} — ${item.error}`}
                      secondary={dateTime.format(new Date(item.momento))}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </>
        )}
      </PageSection>
    </AppShell>
  );
}
