// Tokens de la sesión en el navegador. El de acceso vive solo en memoria; el de renovación en
// sessionStorage, que se borra al cerrar la pestaña. La renovación es de una sola vez aunque
// varias solicitudes la pidan juntas: el backend revoca la sesión si un token se reutiliza.
import type { SessionTokens } from '@pos/contracts';
import { refreshSession } from '../api/auth';

const REFRESH_KEY = 'pos.tokenRenovacion';

let accessToken: string | null = null;
let accessTokenExpiresAt = 0;
let refreshing: Promise<SessionTokens> | null = null;

function readStorage(): string | null {
  try {
    return sessionStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

function writeStorage(value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(REFRESH_KEY);
    else sessionStorage.setItem(REFRESH_KEY, value);
  } catch {
    // Sin almacenamiento, la sesión dura mientras la página esté abierta.
  }
}

export function storeSession(tokens: SessionTokens): void {
  accessToken = tokens.tokenAcceso;
  accessTokenExpiresAt = Date.parse(tokens.tokenAccesoVenceEn);
  writeStorage(tokens.tokenRenovacion);
}

export function storeAccessToken(token: string, expiresAt: string): void {
  accessToken = token;
  accessTokenExpiresAt = Date.parse(expiresAt);
}

export function clearSession(): void {
  accessToken = null;
  accessTokenExpiresAt = 0;
  writeStorage(null);
}

export function hasStoredSession(): boolean {
  return readStorage() !== null;
}

// Token de acceso vigente, si lo hay (con un margen para que no venza en el camino).
export function currentAccessToken(): string | null {
  return accessToken !== null && Date.now() < accessTokenExpiresAt - 10_000 ? accessToken : null;
}

export function renewSession(): Promise<SessionTokens> {
  const stored = readStorage();
  if (stored === null) return Promise.reject(new Error('No hay una sesión para renovar.'));
  refreshing ??= refreshSession(stored)
    .then((tokens) => {
      storeSession(tokens);
      return tokens;
    })
    .catch((error: unknown) => {
      clearSession();
      throw error;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
