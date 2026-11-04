// PIN de autorización y autorizaciones in situ de un solo uso
// (T-043 a T-045; RF-113, RF-141, RF-145, Const. 13, AD-13).
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import { ApplicationError, forbiddenError } from '../../../compartido/aplicacion/errors.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import { decide } from '../../../compartido/aplicacion/permissions.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { assertValidPin } from '../dominio/credentials.js';
import { branchesOf } from '../dominio/roles.js';
import type { CredentialGuard } from './credential-guard.js';
import type {
  Authorization,
  AuthorizationCredentialRepository,
  AuthorizationRepository,
  AuthorizationType,
  SecretHasher,
  UserAccount,
  UserRepository,
} from './ports.js';

export interface AuthorizationDependencies {
  uow: UnitOfWork;
  users: UserRepository;
  credentials: AuthorizationCredentialRepository;
  authorizations: AuthorizationRepository;
  hasher: SecretHasher;
  guard: CredentialGuard;
  access: AccessControl;
  commercialAudit: CommercialAuditLog;
  clock: Clock;
  ids: IdGenerator;
}

// Un AS o un AC fija su propio PIN (T-043). Un VO no puede.
export class SetAuthorizationPin {
  constructor(private readonly deps: AuthorizationDependencies) {}

  async execute(context: SecurityContext, pin: string): Promise<void> {
    await this.deps.access.check(context, 'autorizaciones.autorizar');
    const tenantId = this.deps.access.requireTenant(context);
    assertValidPin(pin);
    const pinHash = await this.deps.hasher.hash(pin);
    await this.deps.uow.run(
      () =>
        this.deps.credentials.upsertPin(tenantId, context.userId, pinHash, this.deps.clock.now()),
      { tenantId },
    );
  }
}

export interface AuthorizeOperationInput {
  type: AuthorizationType;
  operationRef: string;
  branchId: string;
  authorizerId: string;
  pin: string;
  ip: string | null;
}

// Rol con el que el autorizante puede autorizar en esa sucursal, según la matriz §5.18:
// el AS de la sucursal o un AC del comercio presente (RF-141).
function authorizingRole(
  authorizer: UserAccount,
  tenantId: string,
  branchId: string,
): 'AS' | 'AC' | null {
  for (const role of ['AS', 'AC'] as const) {
    const decision = decide(
      {
        userId: authorizer.id,
        tenantId: authorizer.tenantId,
        activeRole: authorizer.assignments.some((a) => a.role === role) ? role : null,
        branchIds: branchesOf(authorizer.assignments, role),
        sessionId: '',
      },
      'autorizaciones.autorizar',
      { tenantId, branchId },
    );
    if (decision.allowed) return role;
  }
  return null;
}

// Emite una autorización de un solo uso ligada a la operación y al solicitante (T-044).
// El solicitante sale del token; nunca puede autorizarse a sí mismo (RF-113).
export class AuthorizeOperation {
  constructor(private readonly deps: AuthorizationDependencies) {}

  async execute(context: SecurityContext, input: AuthorizeOperationInput): Promise<Authorization> {
    const tenantId = this.deps.access.requireTenant(context);
    if (context.activeRole === null || context.activeRole === 'SA') throw forbiddenError();
    if (context.activeRole !== 'AC' && !context.branchIds.includes(input.branchId)) {
      throw forbiddenError();
    }
    if (input.authorizerId === context.userId) {
      throw new ApplicationError(
        'forbidden',
        'AUTOAUTORIZACION',
        'Quien autoriza no puede ser quien solicitó la operación.',
      );
    }

    const origin = { ip: input.ip, actorId: input.authorizerId, tenantId };
    await this.deps.guard.assertNotLocked('pin', input.authorizerId, origin);

    const authorizer = await this.deps.users.findInTenant(tenantId, input.authorizerId);
    const role = authorizer?.isActive
      ? authorizingRole(authorizer, tenantId, input.branchId)
      : null;
    if (!authorizer || role === null) {
      throw new ApplicationError(
        'forbidden',
        'AUTORIZANTE_NO_HABILITADO',
        'La persona elegida no puede autorizar operaciones en esta sucursal.',
      );
    }

    const pinHash = await this.deps.uow.run(
      () => this.deps.credentials.findPinHash(tenantId, authorizer.id),
      { tenantId },
    );
    const pinOk = pinHash !== undefined && (await this.deps.hasher.verify(pinHash, input.pin));
    if (!pinOk) {
      // Si con este fallo se bloquea el PIN, queda auditado y el próximo intento responde bloqueado.
      // La alerta al AC por el bloqueo se conecta en T-209.
      await this.deps.guard.recordFailure('pin', authorizer.id, origin);
      throw new ApplicationError('forbidden', 'PIN_INCORRECTO', 'El PIN no es correcto.');
    }
    await this.deps.guard.recordSuccess('pin', authorizer.id, origin);

    const authorization: Authorization = {
      id: this.deps.ids.next(),
      tenantId,
      branchId: input.branchId,
      type: input.type,
      operationRef: input.operationRef,
      requesterId: context.userId,
      authorizerId: authorizer.id,
      issuedAt: this.deps.clock.now(),
      usedAt: null,
    };
    await this.deps.uow.run(
      async () => {
        await this.deps.authorizations.insert(authorization);
        // RF-018: toda autorización por PIN queda en la auditoría comercial.
        await this.deps.commercialAudit.record({
          tenantId,
          branchId: input.branchId,
          userId: authorizer.id,
          activeRole: role,
          action: 'autorizacion_pin',
          entity: 'autorizacion',
          entityId: authorization.id,
          after: {
            tipo: authorization.type,
            operacionRef: authorization.operationRef,
            solicitanteId: authorization.requesterId,
          },
          authorizationId: authorization.id,
        });
      },
      { tenantId },
    );
    return authorization;
  }
}

export interface Authorizer {
  id: string;
  name: string;
  role: 'AS' | 'AC';
}

// Quiénes pueden autorizar con PIN una operación en la sucursal (para el modal de PIN del POS):
// los AS de esa sucursal y los AC del comercio, activos y con PIN, salvo el propio solicitante.
export class ListAuthorizers {
  constructor(private readonly deps: AuthorizationDependencies) {}

  async execute(context: SecurityContext, branchId: string): Promise<Authorizer[]> {
    const tenantId = this.deps.access.requireTenant(context);
    if (context.activeRole === null || context.activeRole === 'SA') throw forbiddenError();
    if (context.activeRole !== 'AC' && !context.branchIds.includes(branchId)) {
      throw forbiddenError();
    }
    const users = await this.deps.users.listByTenant(tenantId);
    const authorizers: Authorizer[] = [];
    await this.deps.uow.run(
      async () => {
        for (const user of users) {
          if (!user.isActive || user.id === context.userId) continue;
          const role = authorizingRole(user, tenantId, branchId);
          if (role === null) continue;
          if ((await this.deps.credentials.findPinHash(tenantId, user.id)) === undefined) continue;
          authorizers.push({ id: user.id, name: user.name, role });
        }
      },
      { tenantId },
    );
    // Primero los AS de la sucursal, después los AC.
    return authorizers.sort((a, b) =>
      a.role === b.role ? a.name.localeCompare(b.name, 'es') : a.role === 'AS' ? -1 : 1,
    );
  }
}

// Consulta de una autorización por quien la pidió, el AS de la sucursal o el AC.
export class GetAuthorization {
  constructor(private readonly deps: AuthorizationDependencies) {}

  async execute(context: SecurityContext, id: string): Promise<Authorization> {
    const tenantId = this.deps.access.requireTenant(context);
    const found = await this.deps.uow.run(() => this.deps.authorizations.findById(id), {
      tenantId,
    });
    const visible =
      found !== undefined &&
      (context.activeRole === 'AC' ||
        found.requesterId === context.userId ||
        context.branchIds.includes(found.branchId));
    if (!visible) return this.deps.access.notFound(context, 'autorizacion', id);
    return found;
  }
}

// Consumo de una autorización por el caso de uso que la exige, dentro de su transacción.
// Una autorización ya usada, de otra operación o de otro solicitante se rechaza.
export class ConsumeAuthorization {
  constructor(private readonly deps: AuthorizationDependencies) {}

  async execute(input: {
    id: string;
    type: AuthorizationType;
    operationRef: string;
    requesterId: string;
  }): Promise<void> {
    const consumed = await this.deps.authorizations.consume({
      ...input,
      at: this.deps.clock.now(),
    });
    if (!consumed) {
      throw new ApplicationError(
        'conflict',
        'AUTORIZACION_INVALIDA',
        'La autorización no corresponde a esta operación o ya se usó.',
      );
    }
  }
}
