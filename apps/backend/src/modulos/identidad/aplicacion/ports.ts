// Puertos de salida del módulo de identidad.
import type { Role } from '../../../compartido/dominio/roles.js';
import type { AttemptResult } from '../dominio/lockout.js';
import type { RoleAssignment } from '../dominio/roles.js';

export type TenantStatus = 'activo' | 'suspendido' | 'baja';

export interface UserAccount {
  id: string;
  tenantId: string | null;
  email: string;
  name: string;
  emailValidated: boolean;
  passwordHash: string;
  lastActiveRole: Role | null;
  isActive: boolean;
  // Estado del comercio del usuario. Nulo para el SA.
  tenantStatus: TenantStatus | null;
  assignments: RoleAssignment[];
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserAccount | undefined>;
  findById(id: string): Promise<UserAccount | undefined>;
  // Solo si el usuario pertenece a ese comercio (RN-01).
  findInTenant(tenantId: string, id: string): Promise<UserAccount | undefined>;
  setLastActiveRole(userId: string, role: Role): Promise<void>;
  setPasswordHash(userId: string, passwordHash: string): Promise<void>;
  markEmailValidated(userId: string): Promise<void>;
}

export interface SessionToken {
  id: string;
  sessionId: string;
  userId: string;
  activeRole: Role | null;
  issuedAt: Date;
  expiresAt: Date;
  lastActivity: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
}

export interface NewSessionToken {
  id: string;
  sessionId: string;
  userId: string;
  tokenHash: string;
  activeRole: Role | null;
  issuedAt: Date;
  expiresAt: Date;
}

// Tokens de renovación (AD-11). Solo se guarda su hash.
export interface SessionRepository {
  insert(token: NewSessionToken): Promise<void>;
  // Bloquea la fila hasta el final de la transacción: dos renovaciones no rotan el mismo token.
  findByHashForUpdate(tokenHash: string): Promise<SessionToken | undefined>;
  markReplaced(id: string, replacedBy: string, at: Date): Promise<void>;
  revokeSession(sessionId: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<void>;
  setActiveRole(sessionId: string, role: Role): Promise<void>;
}

export type OneTimeTokenType = 'validacion' | 'recuperacion';

export interface OneTimeTokenRepository {
  insert(token: {
    id: string;
    userId: string;
    type: OneTimeTokenType;
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<void>;
  // Un token nuevo deja sin efecto los anteriores del mismo tipo.
  invalidateUnused(userId: string, type: OneTimeTokenType, at: Date): Promise<void>;
  // Lo marca usado y devuelve su usuario, solo si existe, no se usó y no venció (RF-008).
  consume(type: OneTimeTokenType, tokenHash: string, at: Date): Promise<string | undefined>;
}

export type CredentialType = 'contrasena' | 'pin';

export interface AccessAttemptRepository {
  // Se registra siempre, aunque la operación que lo origina se revierta.
  record(attempt: {
    type: CredentialType;
    identifier: string;
    result: AttemptResult;
    ip: string | null;
    at: Date;
  }): Promise<void>;
  recent(
    type: CredentialType,
    identifier: string,
    since: Date,
  ): Promise<{ at: Date; result: AttemptResult }[]>;
}

// Puerto HashDeSecretos (T-025, RF-156): contraseñas y PIN se guardan de forma irreversible.
export interface SecretHasher {
  hash(secret: string): Promise<string>;
  verify(hash: string, secret: string): Promise<boolean>;
}

// Tokens opacos de alta entropía (renovación, validación, recuperación).
export interface OpaqueTokens {
  generate(): { token: string; hash: string };
  hash(token: string): string;
}

export interface AuthorizationCredentialRepository {
  upsertPin(tenantId: string, userId: string, pinHash: string, at: Date): Promise<void>;
  findPinHash(tenantId: string, userId: string): Promise<string | undefined>;
}

export const AUTHORIZATION_TYPES = [
  'descuento',
  'credito',
  'anulacion',
  'reembolso',
  'retiro',
  'pago_por_verificar',
  'cierre_forzado',
] as const;

export type AuthorizationType = (typeof AUTHORIZATION_TYPES)[number];

export interface Authorization {
  id: string;
  tenantId: string;
  branchId: string;
  type: AuthorizationType;
  operationRef: string;
  requesterId: string;
  authorizerId: string;
  issuedAt: Date;
  usedAt: Date | null;
}

export interface AuthorizationRepository {
  insert(authorization: Authorization): Promise<void>;
  findById(id: string): Promise<Authorization | undefined>;
  // La marca usada solo si coincide con la operación y el solicitante y no se usó antes.
  consume(input: {
    id: string;
    type: AuthorizationType;
    operationRef: string;
    requesterId: string;
    at: Date;
  }): Promise<boolean>;
}
