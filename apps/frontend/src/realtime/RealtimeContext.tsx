// Conexión en vivo con el backend (T-230, T-231; RF-061, RF-062, AD-06). Recibe los cambios de
// stock de la sucursal del VO y el aviso de alertas nuevas. Si la conexión se corta, informa
// "sin conexión" (el POS bloquea agregar y cobrar) y reintenta sola. Al volver, avisa la
// reconexión para que cada pantalla pida su estado vigente.
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
import { REALTIME_URL } from '../api/httpClient';
import { useAuth } from '../auth/AuthContext';

// sin_conexion: se cortó o no se pudo conectar. no_disponible: el servidor rechazó la
// suscripción (no es un corte de red y no bloquea nada).
export type RealtimeStatus = 'conectando' | 'conectado' | 'sin_conexion' | 'no_disponible';

export interface StockChange {
  productoId: string;
  disponible: string;
}

export interface RealtimeValue {
  status: RealtimeStatus;
  // Cambia con cada aviso de alertas (y al reconectar): la pantalla vuelve a pedir la lista.
  alertsVersion: number;
  // Cuenta las reconexiones después de un corte.
  reconnections: number;
  onStock: (listener: (change: StockChange) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeValue | null>(null);

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 10_000;
// Antes de que venza el token de acceso, se envía el renovado.
const TOKEN_REFRESH_MS = 60_000;
// Rechazos definitivos: sin permiso o sucursal inexistente.
const FINAL_CLOSE_CODES = new Set([4403, 4404]);

export function RealtimeProvider({
  branchId,
  children,
}: {
  // Sucursal cuyo stock se recibe (la del VO); nula para recibir solo alertas.
  branchId: string | null;
  children: ReactNode;
}) {
  const { accessToken } = useAuth();
  const [status, setStatus] = useState<RealtimeStatus>('conectando');
  const [alertsVersion, setAlertsVersion] = useState(0);
  const [reconnections, setReconnections] = useState(0);
  const listeners = useRef(new Set<(change: StockChange) => void>());

  useEffect(() => {
    let socket: WebSocket | null = null;
    let stopped = false;
    let retryMs = RETRY_MIN_MS;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let wasConnected = false;
    let lostConnection = false;

    const scheduleRetry = () => {
      if (stopped || retryTimer !== null) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    };

    const connect = () => {
      const current = new WebSocket(REALTIME_URL);
      socket = current;
      current.onopen = () => {
        accessToken().then(
          (token) => {
            if (current.readyState === WebSocket.OPEN) {
              current.send(JSON.stringify({ tipo: 'autenticar', token, sucursalId: branchId }));
            }
          },
          () => {
            current.close();
          },
        );
      };
      current.onmessage = (event: MessageEvent<string>) => {
        let message: { tipo?: unknown; productoId?: unknown; disponible?: unknown };
        try {
          message = JSON.parse(event.data) as typeof message;
        } catch {
          return;
        }
        if (message.tipo === 'listo') {
          retryMs = RETRY_MIN_MS;
          setStatus('conectado');
          if (wasConnected && lostConnection) setReconnections((n) => n + 1);
          wasConnected = true;
          lostConnection = false;
          setAlertsVersion((n) => n + 1);
        } else if (message.tipo === 'alertas') {
          setAlertsVersion((n) => n + 1);
        } else if (
          message.tipo === 'stock' &&
          typeof message.productoId === 'string' &&
          typeof message.disponible === 'string'
        ) {
          const change = { productoId: message.productoId, disponible: message.disponible };
          for (const listener of listeners.current) listener(change);
        }
      };
      current.onclose = (event: CloseEvent) => {
        if (socket !== current || stopped) return;
        socket = null;
        if (FINAL_CLOSE_CODES.has(event.code)) {
          setStatus('no_disponible');
          return;
        }
        lostConnection = true;
        setStatus('sin_conexion');
        scheduleRetry();
      };
    };

    connect();
    const tokenTimer = setInterval(() => {
      const current = socket;
      if (current?.readyState !== WebSocket.OPEN) return;
      accessToken().then(
        (token) => {
          if (current.readyState === WebSocket.OPEN) {
            current.send(JSON.stringify({ tipo: 'token', token }));
          }
        },
        () => undefined,
      );
    }, TOKEN_REFRESH_MS);

    return () => {
      stopped = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      clearInterval(tokenTimer);
      socket?.close();
      socket = null;
    };
  }, [accessToken, branchId]);

  const onStock = useCallback((listener: (change: StockChange) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo(
    () => ({ status, alertsVersion, reconnections, onStock }),
    [status, alertsVersion, reconnections, onStock],
  );
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

const OFFLINE: RealtimeValue = {
  status: 'no_disponible',
  alertsVersion: 0,
  reconnections: 0,
  onStock: () => () => undefined,
};

// Fuera del proveedor (por ejemplo, en el SA) no hay canal en vivo.
export function useRealtime(): RealtimeValue {
  return useContext(RealtimeContext) ?? OFFLINE;
}
