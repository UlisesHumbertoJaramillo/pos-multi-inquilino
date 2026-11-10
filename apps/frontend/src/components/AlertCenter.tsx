// Alertas del rol activo (T-230, T-258, T-259; RF-041, RF-098, RF-127, RF-189, RF-190, D-91, D-99).
// Un mismo estado alimenta el indicador del encabezado, el panel de alertas y el aviso de una
// alerta crítica que llega en vivo. Qué ve cada uno, la cantidad y la más grave las decide el
// backend; resolver una alerta la resuelve para todos los del rol.
import type { AlertSummary, RoleAlert } from '@pos/contracts';
import NotificationsOutlined from '@mui/icons-material/NotificationsOutlined';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { alertsApi } from '../api/alerts';
import { ApiError } from '../api/httpClient';
import { describeAlert } from '../api/inventory';
import { useAuth } from '../auth/AuthContext';
import { useRealtime } from '../realtime/RealtimeContext';
import { SEVERITY_NAMES, SEVERITY_PALETTE } from '../theme';
import { DetailPanel } from './DetailPanel';
import { errorMessage } from './PageSection';
import { alertSeverity, SeverityIcon, Status } from './Status';

interface AlertsValue {
  alerts: RoleAlert[];
  summary: AlertSummary;
  // Alerta crítica que llegó en vivo y nadie atendió todavía.
  pendingCritical: RoleAlert | null;
  openPanel: () => void;
  acknowledge: () => void;
}

const EMPTY: AlertSummary = { cantidad: 0, severidadMaxima: null };
const AlertsContext = createContext<AlertsValue | null>(null);

export function useAlerts(): AlertsValue | null {
  return useContext(AlertsContext);
}

export function AlertsProvider({ children }: { children: ReactNode }) {
  const { request } = useAuth();
  const api = useMemo(() => alertsApi(request), [request]);
  const { alertsVersion } = useRealtime();
  const [alerts, setAlerts] = useState<RoleAlert[]>([]);
  const [summary, setSummary] = useState<AlertSummary>(EMPTY);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<RoleAlert | null>(null);
  const [pendingCritical, setPendingCritical] = useState<RoleAlert | null>(null);
  // Alertas ya conocidas: solo una crítica nueva, que llega en vivo, se destaca.
  const known = useRef<Set<string> | null>(null);

  const load = useCallback(() => {
    api.list().then(
      (list) => {
        setAlerts(list);
        const seen = known.current;
        if (seen !== null) {
          const arrived = list.find((a) => a.severidad === 'critica' && !seen.has(a.id));
          if (arrived) setPendingCritical(arrived);
        }
        known.current = new Set([...(seen ?? []), ...list.map((a) => a.id)]);
      },
      () => {
        // Sin conexión, se conserva la última lista conocida.
      },
    );
    api.summary().then(setSummary, () => undefined);
  }, [api]);

  useEffect(() => {
    load();
  }, [load, alertsVersion]);

  async function resolve(alert: RoleAlert, note: string | null) {
    setError(null);
    try {
      await api.resolve(alert.id, note);
      setResolving(null);
      if (pendingCritical?.id === alert.id) setPendingCritical(null);
      load();
    } catch (e: unknown) {
      if (e instanceof ApiError && e.code === 'NOTA_REQUERIDA') {
        setResolving(alert);
        return;
      }
      setError(errorMessage(e, 'No se pudo resolver la alerta.'));
    }
  }

  const value: AlertsValue = {
    alerts,
    summary,
    pendingCritical,
    openPanel: () => {
      setPendingCritical(null);
      setOpen(true);
    },
    acknowledge: () => {
      setPendingCritical(null);
    },
  };

  return (
    <AlertsContext.Provider value={value}>
      {children}
      <DetailPanel
        title="Alertas"
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      >
        <Stack spacing={1.5}>
          {error !== null && <Alert severity="error">{error}</Alert>}
          {alerts.length === 0 && (
            <Typography color="text.secondary">No hay alertas pendientes.</Typography>
          )}
          {alerts.map((alert) => (
            <AlertItem key={alert.id} alert={alert} onResolve={() => void resolve(alert, null)} />
          ))}
        </Stack>
      </DetailPanel>
      {resolving && (
        <ResolveDialog
          alert={resolving}
          onConfirm={(note) => void resolve(resolving, note)}
          onCancel={() => {
            setResolving(null);
          }}
        />
      )}
    </AlertsContext.Provider>
  );
}

function AlertItem({ alert, onResolve }: { alert: RoleAlert; onResolve: () => void }) {
  const severity = alertSeverity(alert.severidad);
  return (
    <Box
      sx={(t) => ({
        borderLeft: `4px solid ${t.palette[SEVERITY_PALETTE[severity]].main}`,
        pl: 1.5,
        py: 0.5,
      })}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Status severity={severity} label={SEVERITY_NAMES[severity]} />
        {alert.sucursal && (
          <Typography variant="body2" color="text.secondary">
            {alert.sucursal}
          </Typography>
        )}
        {alert.ultimoRecordatorio && (
          <Typography variant="body2" color="text.secondary">
            Recordatorio
          </Typography>
        )}
      </Stack>
      <Typography sx={{ mt: 0.5 }}>{describeAlert(alert)}</Typography>
      <Stack direction="row" sx={{ alignItems: 'center', mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
          {new Date(alert.creadaEn).toLocaleString('es-AR')}
        </Typography>
        {alert.resolubleAMano && (
          <Button size="small" onClick={onResolve}>
            Resolver
          </Button>
        )}
      </Stack>
    </Box>
  );
}

// Indicador del encabezado (RF-189): la cantidad y el ícono de la más grave.
export function AlertIndicator() {
  const alerts = useAlerts();
  if (!alerts) return null;
  const { cantidad, severidadMaxima } = alerts.summary;
  const severity = severidadMaxima === null ? null : alertSeverity(severidadMaxima);
  const label =
    severity === null
      ? `Alertas (${String(cantidad)})`
      : `Alertas (${String(cantidad)}), la más grave: ${SEVERITY_NAMES[severity]}`;
  return (
    <Button
      aria-label={label}
      color={severity === null ? 'inherit' : SEVERITY_PALETTE[severity]}
      variant={severity === 'critica' ? 'contained' : 'text'}
      startIcon={
        severity === null ? (
          <NotificationsOutlined />
        ) : (
          <SeverityIcon severity={severity} color="inherit" />
        )
      }
      onClick={alerts.openPanel}
      sx={{ minWidth: 0 }}
    >
      {cantidad}
    </Button>
  );
}

// Aviso de una alerta crítica que llegó en vivo (RF-190): queda hasta que alguien la atiende.
export function CriticalAlertNotice() {
  const alerts = useAlerts();
  const critical = alerts?.pendingCritical ?? null;
  if (!alerts || critical === null) return null;
  return (
    <Alert
      severity="error"
      variant="filled"
      role="alert"
      data-testid="alerta-critica"
      sx={{ mb: 2 }}
      action={
        <Stack direction="row" spacing={1}>
          <Button color="inherit" variant="outlined" onClick={alerts.openPanel}>
            Ver alertas
          </Button>
          <Button color="inherit" onClick={alerts.acknowledge}>
            Entendido
          </Button>
        </Stack>
      }
    >
      <AlertTitle>Alerta crítica</AlertTitle>
      {describeAlert(critical)}
    </Alert>
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
