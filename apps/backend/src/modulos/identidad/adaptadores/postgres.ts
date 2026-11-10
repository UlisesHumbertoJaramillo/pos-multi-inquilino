// Repositorios PostgreSQL del módulo de identidad.
// Las tablas de identidad no se aíslan con seguridad a nivel de fila (el inicio de sesión ocurre
// antes de conocer el comercio): las consultas por comercio lo filtran explícitamente (RN-01).
// credencial_autorizacion y autorizacion sí están aisladas y se usan dentro de una transacción
// con el comercio fijado.
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import { isRole, type Role } from '../../../compartido/dominio/roles.js';
import type { AttemptResult } from '../dominio/lockout.js';
import type { RoleAssignment } from '../dominio/roles.js';
import type {
  AccessAttemptRepository,
  Authorization,
  AuthorizationCredentialRepository,
  AuthorizationRepository,
  AuthorizationType,
  CredentialType,
  NewSessionToken,
  NewUserAccount,
  OneTimeTokenRepository,
  OneTimeTokenType,
  SessionRepository,
  SessionToken,
  TenantStatus,
  UserAccount,
  UserRepository,
} from '../aplicacion/ports.js';

interface UserRow {
  id: string;
  tenant_id: string | null;
  email: string;
  nombre: string;
  email_validado: boolean;
  hash_contrasena: string;
  ultimo_rol_activo: string | null;
  is_active: boolean;
  contrasena_definida: boolean;
  comercio_estado: TenantStatus | null;
  modulo_facturacion: boolean | null;
  roles: { role: string; branchId: string | null }[];
}

const USER_SELECT = `
  SELECT u.id, u.tenant_id, u.email, u.nombre, u.email_validado, u.hash_contrasena,
         u.ultimo_rol_activo, u.is_active, u.contrasena_definida, c.estado AS comercio_estado,
         c.modulo_facturacion,
         coalesce(json_agg(json_build_object('role', r.rol, 'branchId', r.sucursal_id))
                  FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
    FROM usuario u
    LEFT JOIN comercio c ON c.id = u.tenant_id
    LEFT JOIN usuario_rol r ON r.usuario_id = u.id AND r.is_active`;

function toAccount(row: UserRow): UserAccount {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    name: row.nombre,
    emailValidated: row.email_validado,
    passwordHash: row.hash_contrasena,
    lastActiveRole: isRole(row.ultimo_rol_activo) ? row.ultimo_rol_activo : null,
    isActive: row.is_active,
    tenantStatus: row.comercio_estado,
    billingModule: row.modulo_facturacion === true,
    passwordDefined: row.contrasena_definida,
    assignments: row.roles.flatMap((assignment) =>
      isRole(assignment.role) ? [{ role: assignment.role, branchId: assignment.branchId }] : [],
    ),
  };
}

export class PgUserRepository implements UserRepository {
  constructor(
    private readonly db: PgDatabase,
    private readonly newId: () => string,
  ) {}

  private async findOne(where: string, values: unknown[]): Promise<UserAccount | undefined> {
    const result = await this.db.query<UserRow>(
      `${USER_SELECT} WHERE ${where} GROUP BY u.id, c.estado, c.modulo_facturacion`,
      values,
    );
    const row = result.rows[0];
    return row ? toAccount(row) : undefined;
  }

  findByEmail(email: string) {
    return this.findOne('u.email = $1', [email]);
  }

  findById(id: string) {
    return this.findOne('u.id = $1', [id]);
  }

  findInTenant(tenantId: string, id: string) {
    return this.findOne('u.id = $1 AND u.tenant_id = $2', [id, tenantId]);
  }

  async listByTenant(tenantId: string): Promise<UserAccount[]> {
    const result = await this.db.query<UserRow>(
      `${USER_SELECT} WHERE u.tenant_id = $1 GROUP BY u.id, c.estado, c.modulo_facturacion ORDER BY u.nombre`,
      [tenantId],
    );
    return result.rows.map(toAccount);
  }

  // Los roles que se quitan quedan dados de baja, con quién y cuándo (RF-018).
  async replaceRoles(
    userId: string,
    assignments: RoleAssignment[],
    by: string,
    at: Date,
  ): Promise<void> {
    await this.db.query(
      `UPDATE usuario_rol SET is_active = false, desactivado_en = $2, desactivado_por = $3
        WHERE usuario_id = $1 AND is_active`,
      [userId, at, by],
    );
    for (const assignment of assignments) await this.insertRole(userId, assignment, at);
  }

  async deactivate(userId: string, by: string, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE usuario SET is_active = false, desactivado_en = $2, desactivado_por = $3
        WHERE id = $1 AND is_active`,
      [userId, at, by],
    );
  }

  async setLastActiveRole(userId: string, role: Role): Promise<void> {
    await this.db.query('UPDATE usuario SET ultimo_rol_activo = $2 WHERE id = $1', [userId, role]);
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db.query('UPDATE usuario SET hash_contrasena = $2 WHERE id = $1', [
      userId,
      passwordHash,
    ]);
  }

  async markEmailValidated(userId: string): Promise<void> {
    await this.db.query('UPDATE usuario SET email_validado = true WHERE id = $1', [userId]);
  }

  async insert(account: NewUserAccount): Promise<void> {
    await this.db.query(
      `INSERT INTO usuario (id, tenant_id, email, nombre, hash_contrasena, contrasena_definida, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        account.id,
        account.tenantId,
        account.email,
        account.name,
        account.passwordHash,
        account.passwordDefined,
        account.createdAt,
      ],
    );
  }

  async insertRole(userId: string, assignment: RoleAssignment, at: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO usuario_rol (id, usuario_id, rol, sucursal_id, creado_en)
       VALUES ($1, $2, $3, $4, $5)`,
      [this.newId(), userId, assignment.role, assignment.branchId, at],
    );
  }

  async definePassword(userId: string, passwordHash: string): Promise<void> {
    await this.db.query(
      'UPDATE usuario SET hash_contrasena = $2, contrasena_definida = true WHERE id = $1',
      [userId, passwordHash],
    );
  }

  async tenantHasRole(tenantId: string, role: Role): Promise<boolean> {
    const result = await this.db.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM usuario u JOIN usuario_rol r ON r.usuario_id = u.id
          WHERE u.tenant_id = $1 AND r.rol = $2 AND r.is_active AND u.is_active) AS exists`,
      [tenantId, role],
    );
    return result.rows[0]?.exists === true;
  }
}

interface SessionRow {
  id: string;
  sesion_id: string;
  usuario_id: string;
  rol_activo: string | null;
  emitido_en: Date;
  vence_en: Date;
  ultima_actividad: Date;
  revocado_en: Date | null;
  reemplazado_por: string | null;
}

export class PgSessionRepository implements SessionRepository {
  constructor(private readonly db: PgDatabase) {}

  async insert(token: NewSessionToken): Promise<void> {
    await this.db.query(
      `INSERT INTO token_renovacion
         (id, sesion_id, usuario_id, hash_token, rol_activo, emitido_en, vence_en, ultima_actividad)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $6)`,
      [
        token.id,
        token.sessionId,
        token.userId,
        token.tokenHash,
        token.activeRole,
        token.issuedAt,
        token.expiresAt,
      ],
    );
  }

  async findByHashForUpdate(tokenHash: string): Promise<SessionToken | undefined> {
    const result = await this.db.query<SessionRow>(
      `SELECT id, sesion_id, usuario_id, rol_activo, emitido_en, vence_en, ultima_actividad,
              revocado_en, reemplazado_por
         FROM token_renovacion WHERE hash_token = $1 FOR UPDATE`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      sessionId: row.sesion_id,
      userId: row.usuario_id,
      activeRole: isRole(row.rol_activo) ? row.rol_activo : null,
      issuedAt: row.emitido_en,
      expiresAt: row.vence_en,
      lastActivity: row.ultima_actividad,
      revokedAt: row.revocado_en,
      replacedBy: row.reemplazado_por,
    };
  }

  async markReplaced(id: string, replacedBy: string, at: Date): Promise<void> {
    await this.db.query(
      'UPDATE token_renovacion SET revocado_en = $3, reemplazado_por = $2 WHERE id = $1',
      [id, replacedBy, at],
    );
  }

  async revokeSession(sessionId: string, at: Date): Promise<void> {
    await this.db.query(
      'UPDATE token_renovacion SET revocado_en = $2 WHERE sesion_id = $1 AND revocado_en IS NULL',
      [sessionId, at],
    );
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await this.db.query(
      'UPDATE token_renovacion SET revocado_en = $2 WHERE usuario_id = $1 AND revocado_en IS NULL',
      [userId, at],
    );
  }

  async setActiveRole(sessionId: string, role: Role): Promise<void> {
    await this.db.query(
      'UPDATE token_renovacion SET rol_activo = $2 WHERE sesion_id = $1 AND revocado_en IS NULL',
      [sessionId, role],
    );
  }

  async revokeAllForTenant(tenantId: string, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE token_renovacion t SET revocado_en = $2
         FROM usuario u
        WHERE u.id = t.usuario_id AND u.tenant_id = $1 AND t.revocado_en IS NULL`,
      [tenantId, at],
    );
  }

  // Una sesión sigue vigente mientras su último token de renovación no esté revocado.
  async isActive(sessionId: string, userId: string): Promise<boolean> {
    const result = await this.db.query<{ active: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM token_renovacion
          WHERE sesion_id = $1 AND usuario_id = $2 AND revocado_en IS NULL) AS active`,
      [sessionId, userId],
    );
    return result.rows[0]?.active === true;
  }
}

export class PgOneTimeTokenRepository implements OneTimeTokenRepository {
  constructor(private readonly db: PgDatabase) {}

  async insert(token: {
    id: string;
    userId: string;
    type: OneTimeTokenType;
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO token_un_uso (id, usuario_id, tipo, hash_token, creado_en, vence_en)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [token.id, token.userId, token.type, token.tokenHash, token.createdAt, token.expiresAt],
    );
  }

  async invalidateUnused(userId: string, type: OneTimeTokenType, at: Date): Promise<void> {
    await this.db.query(
      'UPDATE token_un_uso SET usado_en = $3 WHERE usuario_id = $1 AND tipo = $2 AND usado_en IS NULL',
      [userId, type, at],
    );
  }

  async consume(type: OneTimeTokenType, tokenHash: string, at: Date): Promise<string | undefined> {
    const result = await this.db.query<{ usuario_id: string }>(
      `UPDATE token_un_uso SET usado_en = $3
        WHERE tipo = $1 AND hash_token = $2 AND usado_en IS NULL AND vence_en > $3
        RETURNING usuario_id`,
      [type, tokenHash, at],
    );
    return result.rows[0]?.usuario_id;
  }
}

// Los intentos se escriben fuera de la transacción en curso: un fallo queda registrado aunque
// la operación se revierta, y el bloqueo no se puede esquivar provocando un error.
export class PgAccessAttemptRepository implements AccessAttemptRepository {
  constructor(
    private readonly db: PgDatabase,
    private readonly newId: () => string,
  ) {}

  async record(attempt: {
    type: CredentialType;
    identifier: string;
    result: AttemptResult;
    ip: string | null;
    at: Date;
  }): Promise<void> {
    await this.db.queryOutsideTransaction(
      `INSERT INTO intento_acceso (id, tipo, identificador, resultado, ip, momento)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [this.newId(), attempt.type, attempt.identifier, attempt.result, attempt.ip, attempt.at],
    );
  }

  async recent(type: CredentialType, identifier: string, since: Date) {
    const result = await this.db.queryOutsideTransaction<{
      momento: Date;
      resultado: AttemptResult;
    }>(
      `SELECT momento, resultado FROM intento_acceso
        WHERE tipo = $1 AND identificador = $2 AND momento >= $3
        ORDER BY momento DESC LIMIT 100`,
      [type, identifier, since],
    );
    return result.rows.map((row) => ({ at: row.momento, result: row.resultado }));
  }
}

export class PgAuthorizationCredentialRepository implements AuthorizationCredentialRepository {
  constructor(
    private readonly db: PgDatabase,
    private readonly newId: () => string,
  ) {}

  async upsertPin(tenantId: string, userId: string, pinHash: string, at: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO credencial_autorizacion (id, tenant_id, usuario_id, hash_pin, actualizado_en)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (usuario_id) DO UPDATE SET hash_pin = EXCLUDED.hash_pin,
                                              actualizado_en = EXCLUDED.actualizado_en`,
      [this.newId(), tenantId, userId, pinHash, at],
    );
  }

  async findPinHash(tenantId: string, userId: string): Promise<string | undefined> {
    const result = await this.db.query<{ hash_pin: string }>(
      'SELECT hash_pin FROM credencial_autorizacion WHERE tenant_id = $1 AND usuario_id = $2',
      [tenantId, userId],
    );
    return result.rows[0]?.hash_pin;
  }
}

interface AuthorizationRow {
  id: string;
  tenant_id: string;
  sucursal_id: string;
  tipo: AuthorizationType;
  operacion_ref: string;
  solicitante_id: string;
  autorizante_id: string;
  emitida_en: Date;
  usada_en: Date | null;
}

export class PgAuthorizationRepository implements AuthorizationRepository {
  constructor(private readonly db: PgDatabase) {}

  async insert(a: Authorization): Promise<void> {
    await this.db.query(
      `INSERT INTO autorizacion (id, tenant_id, sucursal_id, tipo, operacion_ref, solicitante_id,
                                 autorizante_id, emitida_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        a.id,
        a.tenantId,
        a.branchId,
        a.type,
        a.operationRef,
        a.requesterId,
        a.authorizerId,
        a.issuedAt,
      ],
    );
  }

  async findById(id: string): Promise<Authorization | undefined> {
    const result = await this.db.query<AuthorizationRow>(
      'SELECT * FROM autorizacion WHERE id = $1',
      [id],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      branchId: row.sucursal_id,
      type: row.tipo,
      operationRef: row.operacion_ref,
      requesterId: row.solicitante_id,
      authorizerId: row.autorizante_id,
      issuedAt: row.emitida_en,
      usedAt: row.usada_en,
    };
  }

  async consume(input: {
    id: string;
    type: AuthorizationType;
    operationRef: string;
    requesterId: string;
    at: Date;
  }): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE autorizacion SET usada_en = $5
        WHERE id = $1 AND tipo = $2 AND operacion_ref = $3 AND solicitante_id = $4
          AND usada_en IS NULL`,
      [input.id, input.type, input.operationRef, input.requesterId, input.at],
    );
    return result.rowCount === 1;
  }
}
