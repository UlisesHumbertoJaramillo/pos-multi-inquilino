// Puerto EmisorDeTokens (AD-11): tokens de acceso de vida corta que llevan el contexto de seguridad.
import type { SecurityContext } from './security-context.js';

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
}

export interface AccessTokens {
  issue(context: SecurityContext): Promise<IssuedAccessToken>;
  // Devuelve null si el token no es válido, está vencido o fue alterado.
  verify(token: string): Promise<SecurityContext | null>;
}
