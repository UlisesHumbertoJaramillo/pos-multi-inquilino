// Panel técnico del SA: errores internos recientes y estado de los trabajos y del outbox
// (T-058, RF-016). Los periféricos se suman en T-241.
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
            </Stack>
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
