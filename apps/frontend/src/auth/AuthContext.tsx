// Estado de la sesión en la interfaz. No decide permisos: eso lo hace el backend en cada
// solicitud. El rol activo solo cambia qué se muestra (Const. 15).
import type { Role, SessionTokens, SessionUser } from '@pos/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as authApi from '../api/auth';
import { ApiError, apiRequest } from '../api/httpClient';
import {
  clearSession,
  currentAccessToken,
  hasStoredSession,
  renewSession,
  storeAccessToken,
  storeSession,
} from './sessionStore';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  requiresRoleSelection: boolean;
  // Aviso para mostrar en el inicio de sesión (por ejemplo, sesión vencida).
  notice: string | null;
  login: (email: string, password: string) => Promise<SessionTokens>;
  selectRole: (role: Role) => Promise<void>;
  logout: () => Promise<void>;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_EXPIRED = 'Tu sesión venció. Volvé a iniciar sesión.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(hasStoredSession() ? 'loading' : 'anonymous');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [requiresRoleSelection, setRequiresRoleSelection] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const applySession = useCallback((tokens: SessionTokens) => {
    setUser(tokens.usuario);
    setRequiresRoleSelection(tokens.requiereElegirRol);
    setNotice(null);
    setStatus('authenticated');
  }, []);

  const expire = useCallback((message: string | null) => {
    clearSession();
    setUser(null);
    setRequiresRoleSelection(false);
    setNotice(message);
    setStatus('anonymous');
  }, []);

  // Al abrir la página con una sesión guardada, se renueva para recuperar al usuario.
  useEffect(() => {
    if (!hasStoredSession()) return;
    renewSession()
      .then(applySession)
      .catch(() => {
        expire(null);
      });
  }, [applySession, expire]);

  const validAccessToken = useCallback(async (): Promise<string> => {
    const current = currentAccessToken();
    if (current !== null) return current;
    const tokens = await renewSession();
    applySession(tokens);
    return tokens.tokenAcceso;
  }, [applySession]);

  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const send = (token: string) =>
        apiRequest<T>(path, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init.headers)),
            Authorization: `Bearer ${token}`,
          },
        });
      try {
        return await send(await validAccessToken());
      } catch (error: unknown) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        // El token pudo vencer en el camino: se renueva una vez y se reintenta.
        try {
          const tokens = await renewSession();
          applySession(tokens);
          return await send(tokens.tokenAcceso);
        } catch {
          expire(SESSION_EXPIRED);
          throw error;
        }
      }
    },
    [applySession, expire, validAccessToken],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await authApi.login(email, password);
      storeSession(tokens);
      applySession(tokens);
      return tokens;
    },
    [applySession],
  );

  const selectRole = useCallback(
    async (role: Role) => {
      const change = await authApi.selectActiveRole(await validAccessToken(), role);
      storeAccessToken(change.tokenAcceso, change.tokenAccesoVenceEn);
      setUser(change.usuario);
      setRequiresRoleSelection(false);
    },
    [validAccessToken],
  );

  const logout = useCallback(async () => {
    const token = currentAccessToken();
    try {
      if (token !== null) await authApi.logout(token);
    } catch {
      // Aunque el backend no responda, la sesión se cierra en este navegador.
    }
    expire(null);
  }, [expire]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, requiresRoleSelection, notice, login, selectRole, logout, request }),
    [status, user, requiresRoleSelection, notice, login, selectRole, logout, request],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth se usa dentro de AuthProvider.');
  return context;
}
