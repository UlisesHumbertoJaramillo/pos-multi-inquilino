// Casos de uso de las alertas y de la suscripción en vivo (T-227, T-228; RF-041, RF-061, RF-098,
// RF-127, D-91).
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import { forbiddenError } from '../../../compartido/aplicacion/errors.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import {
  type AlertAudience,
  type AlertRole,
  assertResolvable,
  isVisibleTo,
  nextReminder,
} from '../dominio/alerts.js';
import type { AlertInbox, AlertView, BranchLookup } from './ports.js';

export interface AlertDependencies {
  uow: UnitOfWork;
  alerts: AlertInbox;
  branches: BranchLookup;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
}

const ACTION = 'alertas.consultar' as const;

interface Actor {
  tenantId: string;
  userId: string;
  role: AlertRole;
  audience: AlertAudience;
}

function roleOf(context: SecurityContext): AlertRole {
  const role = context.activeRole;
  if (role === 'AC' || role === 'AS' || role === 'VO') return role;
  throw forbiddenError();
}

abstract class AlertUseCase {
  constructor(protected readonly deps: AlertDependencies) {}

  // Verifica el permiso (y la sucursal, si se indica) y corre en una transacción del comercio.
  protected async inTenant<T>(
    context: SecurityContext,
    branchId: string | null,
    work: (actor: Actor) => Promise<T>,
  ): Promise<T> {
    await this.deps.access.check(context, ACTION, branchId === null ? undefined : { branchId });
    const tenantId = this.deps.access.requireTenant(context);
    const role = roleOf(context);
    const actor: Actor = {
      tenantId,
      userId: context.userId,
      role,
      audience: {
        role,
        userId: context.userId,
        branchIds: role === 'AC' ? null : context.branchIds,
      },
    };
    return this.deps.uow.run(
      async () => {
        // El AC puede indicar cualquier sucursal, pero tiene que ser de su comercio (RF-002).
        if (branchId !== null && !(await this.deps.branches.exists(tenantId, branchId))) {
          return this.deps.access.notFound(context, 'sucursal', branchId);
        }
        return work(actor);
      },
      { tenantId },
    );
  }
}

// Las alertas pendientes del rol activo, compartidas por todos los del rol (D-91).
export class ListMyAlerts extends AlertUseCase {
  async execute(context: SecurityContext, branchId: string | null = null): Promise<AlertView[]> {
    return this.inTenant(context, branchId, (actor) =>
      this.deps.alerts.pending({ tenantId: actor.tenantId, branchId, ...actor.audience }),
    );
  }
}

// Resolver a mano una alerta: queda resuelta para todos los del rol y se registra quién (D-91).
export class ResolveAlert extends AlertUseCase {
  async execute(context: SecurityContext, alertId: string, note: string | null): Promise<void> {
    await this.inTenant(context, null, async (actor) => {
      const alert = await this.deps.alerts.find(actor.tenantId, alertId);
      if (!alert || !isVisibleTo(alert, actor.audience)) {
        return this.deps.access.notFound(context, 'alerta', alertId);
      }
      const cleanNote = assertResolvable(alert, note);
      const at = this.deps.clock.now();
      if (!(await this.deps.alerts.resolve(actor.tenantId, alertId, actor.userId, at, cleanNote))) {
        throw new DomainError('ALERTA_RESUELTA', 'La alerta ya está resuelta.');
      }
      await this.deps.audit.record({
        tenantId: actor.tenantId,
        branchId: alert.branchId,
        userId: actor.userId,
        activeRole: actor.role,
        action: 'alerta.resolver',
        entity: 'alerta',
        entityId: alertId,
        before: { tipo: alert.type, resuelta: false },
        after: { tipo: alert.type, resuelta: true, nota: cleanNote },
      });
    });
  }
}

// Pasada del worker: recuerda cada 24 horas las persistentes sin resolver (D-91).
export class AlertReminders {
  constructor(private readonly deps: Pick<AlertDependencies, 'uow' | 'alerts' | 'clock'>) {}

  async sweep(): Promise<number> {
    let reminded = 0;
    for (const tenantId of await this.deps.alerts.activeTenants()) {
      const now = this.deps.clock.now();
      reminded += await this.deps.uow.run(
        () => this.deps.alerts.remind(tenantId, now, nextReminder(now)),
        { tenantId },
      );
    }
    return reminded;
  }
}

// A qué avisos en vivo se suscribe una conexión (AD-06). Lo decide el servidor: el stock de una
// sucursal del ámbito del usuario y las alertas de su rol. Nunca otra sucursal ni otro comercio.
export interface RealtimeSubscription {
  tenantId: string;
  userId: string;
  sessionId: string;
  // Sucursal cuyo stock recibe; nula si solo recibe alertas.
  stockBranchId: string | null;
  audience: AlertAudience;
}

export class AuthorizeRealtime extends AlertUseCase {
  async execute(context: SecurityContext, branchId: string | null): Promise<RealtimeSubscription> {
    return this.inTenant(context, branchId, (actor) =>
      Promise.resolve({
        tenantId: actor.tenantId,
        userId: actor.userId,
        sessionId: context.sessionId,
        stockBranchId: branchId,
        audience: actor.audience,
      }),
    );
  }
}
