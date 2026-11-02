// Parámetros del comercio y métodos de pago (T-065, T-066; RF-135).
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import {
  applyParameterChanges,
  DEFAULT_PARAMETERS,
  type TenantParameters,
} from '../dominio/parameters.js';
import {
  normalizeSurcharge,
  type PaymentMethod,
  type PaymentType,
} from '../dominio/payment-methods.js';
import { assertName } from '../dominio/structure.js';
import type { ParametersRepository, PaymentMethodRepository, TenantDirectory } from './ports.js';

export interface SettingsDependencies {
  uow: UnitOfWork;
  parameters: ParametersRepository;
  paymentMethods: PaymentMethodRepository;
  tenants: TenantDirectory;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
  ids: IdGenerator;
}

abstract class SettingsUseCase {
  constructor(protected readonly deps: SettingsDependencies) {}

  protected async inTenant<T>(context: SecurityContext, work: (tenantId: string) => Promise<T>) {
    await this.deps.access.check(context, 'parametros.gestionar');
    const tenantId = this.deps.access.requireTenant(context);
    return this.deps.uow.run(() => work(tenantId), { tenantId });
  }

  protected async record(
    context: SecurityContext,
    tenantId: string,
    action: string,
    entity: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ) {
    await this.deps.audit.record({
      tenantId,
      userId: context.userId,
      activeRole: 'AC',
      action,
      entity,
      entityId,
      before,
      after,
    });
  }
}

export class GetParameters extends SettingsUseCase {
  async execute(context: SecurityContext): Promise<TenantParameters> {
    return this.inTenant(
      context,
      async (tenantId) => (await this.deps.parameters.find(tenantId)) ?? DEFAULT_PARAMETERS,
    );
  }
}

export class UpdateParameters extends SettingsUseCase {
  async execute(
    context: SecurityContext,
    changes: Partial<TenantParameters>,
  ): Promise<TenantParameters> {
    // La política de facturación es configuración fiscal (matriz §5.18, RF-166).
    if (changes.billingPolicy !== undefined) {
      await this.deps.access.check(context, 'facturacion.configurar');
    }
    return this.inTenant(context, async (tenantId) => {
      const current = (await this.deps.parameters.find(tenantId)) ?? DEFAULT_PARAMETERS;
      const tenant = await this.deps.tenants.find(tenantId);
      const next = applyParameterChanges(current, changes, tenant?.billingModule === true);
      await this.deps.parameters.save(tenantId, next, context.userId, this.deps.clock.now());
      await this.record(
        context,
        tenantId,
        'parametros_modificados',
        'parametro_comercio',
        tenantId,
        current,
        next,
      );
      return next;
    });
  }
}

export class ListPaymentMethods extends SettingsUseCase {
  async execute(context: SecurityContext, includeInactive = false): Promise<PaymentMethod[]> {
    return this.inTenant(context, (tenantId) =>
      this.deps.paymentMethods.list(tenantId, includeInactive),
    );
  }
}

export class CreatePaymentMethod extends SettingsUseCase {
  async execute(
    context: SecurityContext,
    input: { name: string; type: PaymentType; surchargePct: string },
  ): Promise<PaymentMethod> {
    return this.inTenant(context, async (tenantId) => {
      const method: PaymentMethod = {
        id: this.deps.ids.next(),
        tenantId,
        name: assertName(input.name, 60, 'El nombre del método de pago'),
        type: input.type,
        surchargePct: normalizeSurcharge(input.surchargePct),
        isActive: true,
      };
      await this.deps.paymentMethods.insert(method, this.deps.clock.now());
      await this.record(
        context,
        tenantId,
        'metodo_pago_alta',
        'metodo_pago',
        method.id,
        null,
        method,
      );
      return method;
    });
  }
}

export class UpdatePaymentMethod extends SettingsUseCase {
  async execute(
    context: SecurityContext,
    id: string,
    changes: { name?: string; surchargePct?: string },
  ): Promise<PaymentMethod> {
    return this.inTenant(context, async (tenantId) => {
      const current = await this.method(context, tenantId, id);
      const next: PaymentMethod = {
        ...current,
        ...(changes.name === undefined
          ? {}
          : { name: assertName(changes.name, 60, 'El nombre del método de pago') }),
        ...(changes.surchargePct === undefined
          ? {}
          : { surchargePct: normalizeSurcharge(changes.surchargePct) }),
      };
      await this.deps.paymentMethods.update(next);
      // Un cambio de recargo es un cambio de precio (RF-018).
      await this.record(
        context,
        tenantId,
        'metodo_pago_modificado',
        'metodo_pago',
        id,
        current,
        next,
      );
      return next;
    });
  }

  private async method(context: SecurityContext, tenantId: string, id: string) {
    const found = await this.deps.paymentMethods.findById(tenantId, id);
    if (!found) return this.deps.access.notFound(context, 'metodo_pago', id);
    if (!found.isActive) {
      throw new ApplicationError(
        'conflict',
        'YA_DADO_DE_BAJA',
        'El método de pago está dado de baja.',
      );
    }
    return found;
  }
}

export class DeactivatePaymentMethod extends SettingsUseCase {
  async execute(context: SecurityContext, id: string): Promise<void> {
    await this.inTenant(context, async (tenantId) => {
      const found = await this.deps.paymentMethods.findById(tenantId, id);
      if (!found) return this.deps.access.notFound(context, 'metodo_pago', id);
      if (!found.isActive) {
        throw new ApplicationError(
          'conflict',
          'YA_DADO_DE_BAJA',
          'El método de pago está dado de baja.',
        );
      }
      await this.deps.paymentMethods.deactivate(
        tenantId,
        id,
        context.userId,
        this.deps.clock.now(),
      );
      await this.record(context, tenantId, 'metodo_pago_baja', 'metodo_pago', id, found, null);
    });
  }
}
