// Estado de la sesión de un token de acceso (T-052, RF-146).
// El token de acceso es de vida corta (AD-11), pero suspender un comercio, cerrar sesión o
// revocar una cuenta tiene que surtir efecto en la solicitud siguiente: cada solicitud
// autenticada verifica que su sesión siga vigente con una consulta indexada.
import type { SecurityContext } from './security-context.js';

export interface SessionStatus {
  isActive(context: SecurityContext): Promise<boolean>;
}
