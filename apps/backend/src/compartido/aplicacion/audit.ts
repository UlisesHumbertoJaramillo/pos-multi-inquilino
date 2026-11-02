// Puertos de auditoría (AD-10, D-9).
import type { Role } from '../dominio/roles.js';

// Auditoría técnica de plataforma (RF-022): inicios de sesión, accesos denegados, bloqueos...
// Nunca lleva contenido comercial. Se registra aunque la operación que la origina se revierta.
export interface TechnicalAuditEntry {
  type: string;
  actorId?: string | null;
  tenantId?: string | null;
  ip?: string | null;
  detail?: Record<string, unknown>;
}

export interface TechnicalAuditLog {
  record(entry: TechnicalAuditEntry): Promise<void>;
}

// Auditoría comercial del comercio (RF-018): se escribe en la misma transacción que la operación,
// así que se confirma o se revierte junto con ella. Nadie la modifica ni la borra (RF-019).
export interface CommercialAuditEntry {
  tenantId: string;
  branchId?: string | null;
  userId: string;
  activeRole: Exclude<Role, 'SA'>;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  authorizationId?: string | null;
}

export interface CommercialAuditLog {
  record(entry: CommercialAuditEntry): Promise<void>;
}
