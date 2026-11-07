// Centro de alertas del rol activo (T-230; RF-041, RF-098, RF-127, D-91). Se actualiza con el
// aviso en vivo; resolver una alerta la resuelve para todos los del rol. Qué se puede resolver
// y si hace falta nota lo decide el backend: si la pide, se abre el cuadro para escribirla.
import type { RoleAlert } from '@pos/contracts';
import NotificationsOutlined from '@mui/icons-material/NotificationsOutlined';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { alertsApi, SEVERITY_LABELS } from '../api/alerts';
import { ApiError } from '../api/httpClient';
import { describeAlert } from '../api/inventory';
import { useAuth } from '../auth/AuthContext';
import { useRealtime } from '../realtime/RealtimeContext';
import { errorMessage } from './PageSection';

const SEVERITY_COLORS: Record<RoleAlert['severidad'], 'error' | 'warning' | 'info'> = {
  critica: 'error',
  advertencia: 'warning',
  info: 'info',
};

export function AlertCenter() {
  const { request } = useAuth();
  const api = useMemo(() => alertsApi(request), [request]);
  const { alertsVersion } = useRealtime();
  const [alerts, setAlerts] = useState<RoleAlert[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<RoleAlert | null>(null);

  const load = useCallback(() => {
    api.list().then(
      (list) => {
        setAlerts(list);
      },
      () => {
        // Sin conexión, se conserva la última lista conocida.
      },
    );
  }, [api]);

  useEffect(() => {
    load();
  }, [load, alertsVersion]);

  async function resolve(alert: RoleAlert, note: string | null) {
    setError(null);
    try {
      await api.resolve(alert.id, note);
      setResolving(null);
      load();
    } catch (e: unknown) {
      if (e instanceof ApiError && e.code === 'NOTA_REQUERIDA') {
        setResolving(alert);
        return;
      }
      setError(errorMessage(e, 'No se pudo resolver la alerta.'));
    }
  }

  const critical = alerts.some((a) => a.severidad === 'critica');

  return (
    <>
      <IconButton
        aria-label={`Alertas (${String(alerts.length)})`}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Badge badgeContent={alerts.length} color={critical ? 'error' : 'warning'}>
          <NotificationsOutlined />
        </Badge>
      </IconButton>
      <Drawer
        anchor="right"
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      >
        <Stack spacing={1.5} sx={{ p: 2, width: { xs: '100vw', sm: 420 } }} aria-label="Alertas">
          <Typography variant="h6">Alertas</Typography>
          {error !== null && <Alert severity="error">{error}</Alert>}
          {alerts.length === 0 && (
            <Typography color="text.secondary">No hay alertas pendientes.</Typography>
          )}
          {alerts.map((alert) => (
            <Alert
              key={alert.id}
              severity={SEVERITY_COLORS[alert.severidad]}
              action={
                alert.resolubleAMano ? (
                  <Button size="small" color="inherit" onClick={() => void resolve(alert, null)}>
                    Resolver
                  </Button>
                ) : undefined
              }
            >
              <Typography variant="body2">{describeAlert(alert)}</Typography>
              <Typography variant="caption" color="text.secondary">
                {SEVERITY_LABELS[alert.severidad]}
                {alert.sucursal ? ` · ${alert.sucursal}` : ''} ·{' '}
                {new Date(alert.creadaEn).toLocaleString('es-AR')}
                {alert.ultimoRecordatorio ? ' · Recordatorio' : ''}
              </Typography>
            </Alert>
          ))}
        </Stack>
      </Drawer>
      {resolving && (
        <ResolveDialog
          alert={resolving}
          onConfirm={(note) => void resolve(resolving, note)}
          onCancel={() => {
            setResolving(null);
          }}
        />
      )}
    </>
  );
}

function ResolveDialog({
  alert,
  onConfirm,
  onCancel,
}: {
  alert: RoleAlert;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="xs">
      <DialogTitle>Resolver la alerta</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2">{describeAlert(alert)}</Typography>
          <TextField
            label="Qué se hizo para corregirla"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            slotProps={{ htmlInput: { maxLength: 200 } }}
            multiline
            autoFocus
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancelar</Button>
        <Button
          variant="contained"
          disabled={note.trim() === ''}
          onClick={() => {
            onConfirm(note.trim());
          }}
        >
          Resolver
        </Button>
      </DialogActions>
    </Dialog>
  );
}
