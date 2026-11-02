// Casos de uso del SA sobre los comercios (T-050 a T-054;
// RF-013, RF-014, RF-134, RF-146, RF-147, RF-163, RF-164).
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { TechnicalAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import { notFoundError } from '../../../compartido/aplicacion/errors.js';
import type { EventOutbox } from '../../../compartido/aplicacion/event-outbox.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import {
  applyChanges,
  assertValidCurrency,
  assertValidName,
  assertValidTimezone,
  close,
  normalizeCuit,
  reactivate,
  setBillingModule,
  suspend,
  type Tenant,
  type TenantChanges,
} from '../dominio/tenant.js';
import type { FiscalPendingQuery, TenantRepository, TenantSessions } from './ports.js';

export interface TenantDependencies {
  uow: UnitOfWork;
  tenants: TenantRepository;
  fiscalPending: FiscalPendingQuery;
  sessions: TenantSessions;
  outbox: EventOutbox;
  access: AccessControl;
  audit: TechnicalAuditLog;
  clock: Clock;
  ids: IdGenerator;
}

abstract class TenantUseCase {
  constructor(protected readonly deps: TenantDependencies) {}

  protected async load(id: string): Promise<Tenant> {
    const tenant = await this.deps.tenants.findById(id);
    if (!tenant) throw notFoundError();
    return tenant;
  }

  protected async record(context: SecurityContext, type: string, tenant: Tenant, detail = {}) {
    await this.deps.audit.record({
      type,
      actorId: context.userId,
      tenantId: tenant.id,
      detail: { status: tenant.status, ...detail },
    });
  }
}

export interface CreateTenantInput {
  name: string;
  cuit?: string | null;
  currency: string;
  timezone: string;
}

export class CreateTenant extends TenantUseCase {
  async execute(context: SecurityContext, input: CreateTenantInput): Promise<Tenant> {
    await this.deps.access.check(context, 'plataforma.comercios.gestionar');
    assertValidCurrency(input.currency);
    assertValidTimezone(input.timezone);
    const tenant: Tenant = {
      id: this.deps.ids.next(),
      name: assertValidName(input.name),
      cuit: input.cuit ? normalizeCuit(input.cuit) : null,
      currency: input.currency,
      timezone: input.timezone,
      status: 'activo',
      hasOperations: false,
      billingModule: false,
      createdAt: this.deps.clock.now(),
    };
    await this.deps.uow.run(() => this.deps.tenants.insert(tenant));
    await this.record(context, 'comercio_alta', tenant, { currency: tenant.currency });
    return tenant;
  }
}

export class ListTenants extends TenantUseCase {
  async execute(context: SecurityContext): Promise<Tenant[]> {
    await this.deps.access.check(context, 'plataforma.comercios.gestionar');
    return this.deps.tenants.list();
  }
}

export class GetTenant extends TenantUseCase {
  async execute(context: SecurityContext, id: string): Promise<Tenant> {
    await this.deps.access.check(context, 'plataforma.comercios.gestionar');
    return this.load(id);
  }
}

export class UpdateTenant extends TenantUseCase {
  async execute(context: SecurityContext, id: string, changes: TenantChanges): Promise<Tenant> {
    await this.deps.access.check(context, 'plataforma.comercios.gestionar');
    const updated = await this.deps.uow.run(async () => {
      const next = applyChanges(await this.load(id), changes);
      await this.deps.tenants.save(next, context.userId, this.deps.clock.now());
      return next;
    });
    await this.record(context, 'comercio_modificado', updated, {
      fields: Object.keys(changes).join(','),
    });
    return updated;
  }
}

// RF-146: la suspensión cierra al instante las sesiones de sus usuarios y publica el evento,
// al que se suscribirán las ventas para descartar los carritos (T-150).
export class SuspendTenant extends TenantUseCase {
  async execute(context: SecurityContext, id: string): Promise<Tenant> {
    await this.deps.access.check(context, 'plataforma.comercios.gestionar');
    const now = this.deps.clock.now();
    const suspended = await this.deps.uow.run(async () => {
      const next = suspend(await this.load(id));
      await this.deps.tenants.save(next, context.userId, now);
      await this.deps.sessions.revokeAllForTenant(id, now);
      await this.deps.outbox.add({
        type: 'comercio.suspendido',
        tenantId: id,
        payload: { tenantId: id },
      });
      return next;
    });
    await this.record(context, 'comercio_suspendido', suspended);
    return suspended;
  }
}

export class ReactivateTenant extends TenantUseCase {
  async execute(context: SecurityContext, id: string): Promise<Tenant> {
    await this.deps.access.check(context, 'plataforma.comercios.gestionar');
    const reactivated = await this.deps.uow.run(async () => {
      const next = reactivate(await this.load(id));
      await this.deps.tenants.save(next, context.userId, this.deps.clock.now());
      await this.deps.outbox.add({
        type: 'comercio.reactivado',
        tenantId: id,
        payload: { tenantId: id },
      });
      return next;
    });
    await this.record(context, 'comercio_reactivado', reactivated);
    return reactivated;
  }
}

// RF-147, D-52: baja lógica sin comprobantes por regularizar. Los datos se conservan.
export class CloseTenant extends TenantUseCase {
  async execute(context: SecurityContext, id: string): Promise<Tenant> {
    await this.deps.access.check(context, 'plataforma.comercios.gestionar');
    const now = this.deps.clock.now();
    const pending = await this.deps.fiscalPending.pendingFor(id);
    const closed = await this.deps.uow.run(async () => {
      const next = close(await this.load(id), pending);
      await this.deps.tenants.save(next, context.userId, now);
      await this.deps.sessions.revokeAllForTenant(id, now);
      return next;
    });
    await this.record(context, 'comercio_baja', closed);
    return closed;
  }
}

// RF-163, RF-164, D-60.
export class SetTenantBillingModule extends TenantUseCase {
  async execute(context: SecurityContext, id: string, active: boolean): Promise<Tenant> {
    await this.deps.access.check(context, 'plataforma.facturacion.modulo');
    const pending = await this.deps.fiscalPending.pendingFor(id);
    const updated = await this.deps.uow.run(async () => {
      const next = setBillingModule(await this.load(id), active, pending);
      await this.deps.tenants.save(next, context.userId, this.deps.clock.now());
      return next;
    });
    await this.record(
      context,
      active ? 'facturacion_activada' : 'facturacion_desactivada',
      updated,
    );
    return updated;
  }
}
