// Casos de uso de sesión: inicio, renovación, cierre, rol activo y sesión actual
// (T-027, T-028, T-032 a T-036; RF-005, RF-006, RF-009 a RF-011, RF-014, AD-11).
import type { AccessTokens } from '../../../compartido/aplicacion/access-tokens.js';
import type { TechnicalAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import type { Role } from '../../../compartido/dominio/roles.js';
import { assignedRoles, branchesOf, initialActiveRole } from '../dominio/roles.js';
import type { IdentityConfig } from './config.js';
import type { CredentialGuard } from './credential-guard.js';
import type {
  OpaqueTokens,
  SecretHasher,
  SessionRepository,
  UserAccount,
  UserRepository,
} from './ports.js';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  tenantId: string | null;
  roles: Role[];
  activeRole: Role | null;
  branchIds: string[];
}

export interface SessionTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  sessionExpiresAt: Date;
  user: SessionUser;
  // Primer ingreso con varios roles: tiene que elegir uno antes de operar (RF-005).
  requiresRoleSelection: boolean;
}

export interface SessionDependencies {
  uow: UnitOfWork;
  users: UserRepository;
  sessions: SessionRepository;
  hasher: SecretHasher;
  opaqueTokens: OpaqueTokens;
  accessTokens: AccessTokens;
  guard: CredentialGuard;
  audit: TechnicalAuditLog;
  clock: Clock;
  ids: IdGenerator;
  config: IdentityConfig;
}

function invalidCredentials(): ApplicationError {
  return new ApplicationError(
    'unauthenticated',
    'CREDENCIALES_INVALIDAS',
    'El correo o la contraseña no son correctos.',
  );
}

function invalidSession(): ApplicationError {
  return new ApplicationError(
    'unauthenticated',
    'SESION_INVALIDA',
    'La sesión no es válida o venció. Volvé a iniciar sesión.',
  );
}

function sessionUser(account: UserAccount, activeRole: Role | null): SessionUser {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    tenantId: account.tenantId,
    roles: assignedRoles(account.assignments),
    activeRole,
    branchIds: branchesOf(account.assignments, activeRole),
  };
}

// Motivo por el que una cuenta con credenciales correctas no puede operar, o null.
function accessBlocker(account: UserAccount): ApplicationError | null {
  if (!account.emailValidated) {
    return new ApplicationError(
      'forbidden',
      'CORREO_SIN_VALIDAR',
      'Tenés que validar tu correo antes de ingresar. Podés pedir un nuevo correo de validación.',
    );
  }
  // RF-014: mientras el comercio esté suspendido o dado de baja, sus usuarios no ingresan.
  if (account.tenantStatus !== null && account.tenantStatus !== 'activo') {
    return new ApplicationError(
      'forbidden',
      'COMERCIO_NO_DISPONIBLE',
      'El comercio no está disponible. Consultá con el administrador de la plataforma.',
    );
  }
  return null;
}

abstract class SessionUseCase {
  constructor(protected readonly deps: SessionDependencies) {}

  protected async issueAccessToken(
    account: UserAccount,
    activeRole: Role | null,
    sessionId: string,
  ) {
    return this.deps.accessTokens.issue({
      userId: account.id,
      tenantId: account.tenantId,
      activeRole,
      branchIds: branchesOf(account.assignments, activeRole),
      sessionId,
    });
  }

  protected async newRefreshToken(
    account: UserAccount,
    sessionId: string,
    activeRole: Role | null,
    expiresAt: Date,
  ): Promise<{ id: string; token: string }> {
    const { token, hash } = this.deps.opaqueTokens.generate();
    const id = this.deps.ids.next();
    await this.deps.sessions.insert({
      id,
      sessionId,
      userId: account.id,
      tokenHash: hash,
      activeRole,
      issuedAt: this.deps.clock.now(),
      expiresAt,
    });
    return { id, token };
  }

  protected async tokensFor(
    account: UserAccount,
    activeRole: Role | null,
    sessionId: string,
    refreshToken: string,
    sessionExpiresAt: Date,
  ): Promise<SessionTokens> {
    const access = await this.issueAccessToken(account, activeRole, sessionId);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      sessionExpiresAt,
      user: sessionUser(account, activeRole),
      requiresRoleSelection: activeRole === null,
    };
  }
}

export class Login extends SessionUseCase {
  private dummyHash: Promise<string> | undefined;

  async execute(input: {
    email: string;
    password: string;
    ip: string | null;
  }): Promise<SessionTokens> {
    const email = input.email.trim().toLowerCase();
    const origin = { ip: input.ip };
    // El bloqueo se aplica al correo exista o no la cuenta, así no revela qué cuentas existen.
    await this.deps.guard.assertNotLocked('contrasena', email, origin);

    const account = await this.deps.users.findByEmail(email);
    // Con o sin cuenta se verifica un hash: el tiempo de respuesta no delata si el correo existe.
    const passwordOk = await this.deps.hasher.verify(
      account?.passwordHash ?? (await this.getDummyHash()),
      input.password,
    );

    if (!account || !account.isActive || !passwordOk) {
      const lockedUntil = await this.deps.guard.recordFailure('contrasena', email, {
        ...origin,
        actorId: account?.id ?? null,
        tenantId: account?.tenantId ?? null,
      });
      await this.deps.audit.record({
        type: 'login_fallido',
        actorId: account?.id ?? null,
        tenantId: account?.tenantId ?? null,
        ip: input.ip,
        detail: { locked: lockedUntil !== null },
      });
      throw invalidCredentials();
    }

    await this.deps.guard.recordSuccess('contrasena', email, origin);
    const blocker = accessBlocker(account);
    if (blocker) throw blocker;

    const activeRole = initialActiveRole(account.assignments, account.lastActiveRole);
    const sessionId = this.deps.ids.next();
    const sessionExpiresAt = new Date(
      this.deps.clock.now().getTime() + this.deps.config.sessionMaxMs,
    );
    const refresh = await this.deps.uow.run(async () => {
      if (activeRole !== null) await this.deps.users.setLastActiveRole(account.id, activeRole);
      return this.newRefreshToken(account, sessionId, activeRole, sessionExpiresAt);
    });
    await this.deps.audit.record({
      type: 'login_exitoso',
      actorId: account.id,
      tenantId: account.tenantId,
      ip: input.ip,
      detail: { activeRole },
    });
    return this.tokensFor(account, activeRole, sessionId, refresh.token, sessionExpiresAt);
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.deps.hasher.hash(this.deps.opaqueTokens.generate().token);
    return this.dummyHash;
  }
}

// Rota el token de renovación (T-032, T-033). Si se presenta un token ya rotado, se asume robado
// y se revoca toda la sesión.
export class RefreshSession extends SessionUseCase {
  async execute(input: { refreshToken: string; ip: string | null }): Promise<SessionTokens> {
    const now = this.deps.clock.now();
    const hash = this.deps.opaqueTokens.hash(input.refreshToken);

    const outcome = await this.deps.uow.run(async () => {
      const current = await this.deps.sessions.findByHashForUpdate(hash);
      if (!current) return { kind: 'invalid' as const };
      if (current.revokedAt !== null) {
        if (current.replacedBy !== null) {
          await this.deps.sessions.revokeSession(current.sessionId, now);
          return { kind: 'reused' as const, userId: current.userId };
        }
        return { kind: 'invalid' as const };
      }
      // RF-009: inactividad o vencimiento absoluto. No toca turnos ni carritos (D-11).
      const idle = now.getTime() - current.lastActivity.getTime() > this.deps.config.sessionIdleMs;
      if (idle || now >= current.expiresAt) {
        await this.deps.sessions.revokeSession(current.sessionId, now);
        return { kind: 'expired' as const };
      }
      const account = await this.deps.users.findById(current.userId);
      if (!account || !account.isActive || accessBlocker(account) !== null) {
        await this.deps.sessions.revokeSession(current.sessionId, now);
        return { kind: 'invalid' as const };
      }
      const roles = assignedRoles(account.assignments);
      const activeRole =
        current.activeRole !== null && roles.includes(current.activeRole)
          ? current.activeRole
          : null;
      const next = await this.newRefreshToken(
        account,
        current.sessionId,
        activeRole,
        current.expiresAt,
      );
      await this.deps.sessions.markReplaced(current.id, next.id, now);
      return { kind: 'ok' as const, account, activeRole, next, current };
    });

    if (outcome.kind === 'reused') {
      await this.deps.audit.record({
        type: 'token_renovacion_reutilizado',
        actorId: outcome.userId,
        ip: input.ip,
      });
    }
    if (outcome.kind !== 'ok') throw invalidSession();
    return this.tokensFor(
      outcome.account,
      outcome.activeRole,
      outcome.current.sessionId,
      outcome.next.token,
      outcome.current.expiresAt,
    );
  }
}

export class Logout extends SessionUseCase {
  async execute(context: SecurityContext): Promise<void> {
    await this.deps.sessions.revokeSession(context.sessionId, this.deps.clock.now());
  }
}

// Cambio de rol activo sin cerrar sesión (T-036, RF-010, RF-011). El token nuevo lleva los
// permisos y el ámbito del rol elegido; turnos y carritos no se tocan (D-45).
export class SelectActiveRole extends SessionUseCase {
  async execute(
    context: SecurityContext,
    role: Role,
  ): Promise<{ accessToken: string; accessTokenExpiresAt: Date; user: SessionUser }> {
    const account = await this.deps.users.findById(context.userId);
    if (!account?.isActive) throw invalidSession();
    if (!assignedRoles(account.assignments).includes(role)) {
      throw new ApplicationError('forbidden', 'ROL_NO_ASIGNADO', 'No tenés asignado ese rol.');
    }
    await this.deps.uow.run(async () => {
      await this.deps.users.setLastActiveRole(account.id, role);
      await this.deps.sessions.setActiveRole(context.sessionId, role);
    });
    const access = await this.issueAccessToken(account, role, context.sessionId);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      user: sessionUser(account, role),
    };
  }
}

export class GetCurrentSession extends SessionUseCase {
  async execute(context: SecurityContext): Promise<SessionUser> {
    const account = await this.deps.users.findById(context.userId);
    if (!account?.isActive) throw invalidSession();
    // Rol, comercio y sucursales salen del token verificado, no de la solicitud (T-035).
    return {
      ...sessionUser(account, context.activeRole),
      tenantId: context.tenantId,
      branchIds: [...context.branchIds],
    };
  }
}
