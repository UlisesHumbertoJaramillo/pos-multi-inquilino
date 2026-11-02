// Contexto de seguridad de una solicitud autenticada (T-035, RF-001).
// Sale siempre del token verificado en el servidor: el comercio nunca se toma de un parámetro.
import type { Role } from '../dominio/roles.js';

export interface SecurityContext {
  userId: string;
  // Nulo para el SA, que no pertenece a ningún comercio.
  tenantId: string | null;
  // Nulo mientras el usuario no eligió su rol en el primer ingreso (RF-005).
  activeRole: Role | null;
  // Sucursales del rol activo: las del AS o la del VO. Vacío para AC y SA.
  branchIds: readonly string[];
  sessionId: string;
}
