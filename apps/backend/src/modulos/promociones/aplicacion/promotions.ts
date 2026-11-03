// Casos de uso de promociones del AC (T-120; RF-048) y la evaluación que usará ventas (RF-050).
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import {
  assertPromotionName,
  assertValidity,
  isApplicable,
  normalizeRule,
  type Promotion,
  type PromotionRule,
  type PromotionScope,
} from '../dominio/promotions.js';

// La elección de promociones para un carrito (RF-050), para el módulo de ventas.
export { type AppliedPromotion, type CartLine, choosePromotions } from '../dominio/evaluator.js';
export { isApplicable } from '../dominio/promotions.js';

export interface PromotionRepository {
  list(tenantId: string, includeInactive: boolean): Promise<Promotion[]>;
  findById(tenantId: string, id: string): Promise<Promotion | undefined>;
  insert(promotion: Promotion, at: Date): Promise<void>;
  update(promotion: Promotion): Promise<void>;
  deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void>;
}

// Productos, categorías y sucursales del comercio, para validar el alcance.
export interface PromotionTargets {
  target(
    tenantId: string,
    scope: PromotionScope,
    id: string,
  ): Promise<{ id: string; name: string; isActive: boolean } | undefined>;
  names(tenantId: string, ids: readonly string[]): Promise<Map<string, string>>;
  activeBranches(tenantId: string): Promise<string[]>;
}

export interface PromotionDependencies {
  uow: UnitOfWork;
  promotions: PromotionRepository;
  targets: PromotionTargets;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
  ids: IdGenerator;
}

export interface ListedPromotion extends Promotion {
  targetName: string;
  // Vigente ahora en alguna sucursal.
  current: boolean;
}

export interface PromotionInput {
  name: string;
  rule: PromotionRule;
  scope: PromotionScope;
  targetId: string;
  validFrom: Date;
  validUntil: Date;
  branchIds: string[] | null;
}

interface Actor {
  tenantId: string;
  userId: string;
  at: Date;
}

abstract class PromotionUseCase {
  constructor(protected readonly deps: PromotionDependencies) {}

  protected async inTenant<T>(
    context: SecurityContext,
    work: (actor: Actor) => Promise<T>,
  ): Promise<T> {
    await this.deps.access.check(context, 'catalogo.gestionar');
    const tenantId = this.deps.access.requireTenant(context);
    return this.deps.uow.run(
      () => work({ tenantId, userId: context.userId, at: this.deps.clock.now() }),
      { tenantId },
    );
  }

  protected async validInput(actor: Actor, input: PromotionInput): Promise<PromotionInput> {
    const target = await this.deps.targets.target(actor.tenantId, input.scope, input.targetId);
    if (!target?.isActive) {
      throw new DomainError(
        'PROMOCION_INVALIDA',
        input.scope === 'producto'
          ? 'El producto no existe o está dado de baja.'
          : 'La categoría no existe o está dada de baja.',
      );
    }
    assertValidity(input.validFrom, input.validUntil);
    let branchIds: string[] | null = null;
    if (input.branchIds !== null) {
      const active = new Set(await this.deps.targets.activeBranches(actor.tenantId));
      branchIds = [...new Set(input.branchIds)];
      if (branchIds.length === 0 || branchIds.some((id) => !active.has(id))) {
        throw new DomainError(
          'PROMOCION_INVALIDA',
          'Elegí sucursales activas del comercio, o ninguna para todas.',
        );
      }
    }
    return {
      ...input,
      name: assertPromotionName(input.name),
      rule: normalizeRule(input.rule, input.scope),
      branchIds,
    };
  }

  protected async listed(actor: Actor, promotions: Promotion[]): Promise<ListedPromotion[]> {
    const names = await this.deps.targets.names(
      actor.tenantId,
      promotions.map((p) => p.targetId),
    );
    return promotions.map((p) => ({
      ...p,
      targetName: names.get(p.targetId) ?? '—',
      current: isApplicable(p, actor.at, null),
    }));
  }

  protected async record(
    actor: Actor,
    action: string,
    id: string,
    before: unknown,
    after: unknown,
  ) {
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      activeRole: 'AC',
      action,
      entity: 'promocion',
      entityId: id,
      before,
      after,
    });
  }
}

export class ListPromotions extends PromotionUseCase {
  async execute(context: SecurityContext, onlyCurrent = false): Promise<ListedPromotion[]> {
    return this.inTenant(context, async (actor) => {
      const listed = await this.listed(
        actor,
        await this.deps.promotions.list(actor.tenantId, false),
      );
      return onlyCurrent ? listed.filter((p) => p.current) : listed;
    });
  }
}

export class CreatePromotion extends PromotionUseCase {
  async execute(context: SecurityContext, input: PromotionInput): Promise<ListedPromotion> {
    return this.inTenant(context, async (actor) => {
      const valid = await this.validInput(actor, input);
      const promotion: Promotion = {
        id: this.deps.ids.next(),
        tenantId: actor.tenantId,
        ...valid,
        isActive: true,
      };
      await this.deps.promotions.insert(promotion, actor.at);
      await this.record(actor, 'promocion_alta', promotion.id, null, promotion);
      const [listed] = await this.listed(actor, [promotion]);
      if (!listed) throw new Error('No se pudo leer la promoción creada.');
      return listed;
    });
  }
}

export class UpdatePromotion extends PromotionUseCase {
  async execute(
    context: SecurityContext,
    id: string,
    changes: Partial<PromotionInput>,
  ): Promise<ListedPromotion> {
    return this.inTenant(context, async (actor) => {
      const current = await this.deps.promotions.findById(actor.tenantId, id);
      if (!current) return this.deps.access.notFound(context, 'promocion', id);
      if (!current.isActive) {
        throw new ApplicationError(
          'conflict',
          'YA_DADO_DE_BAJA',
          'La promoción está dada de baja.',
        );
      }
      const valid = await this.validInput(actor, {
        name: changes.name ?? current.name,
        rule: changes.rule ?? current.rule,
        scope: changes.scope ?? current.scope,
        targetId: changes.targetId ?? current.targetId,
        validFrom: changes.validFrom ?? current.validFrom,
        validUntil: changes.validUntil ?? current.validUntil,
        branchIds: changes.branchIds === undefined ? current.branchIds : changes.branchIds,
      });
      const next: Promotion = { ...current, ...valid };
      await this.deps.promotions.update(next);
      await this.record(actor, 'promocion_modificada', id, current, next);
      const [listed] = await this.listed(actor, [next]);
      if (!listed) throw new Error('No se pudo leer la promoción.');
      return listed;
    });
  }
}

export class DeactivatePromotion extends PromotionUseCase {
  async execute(context: SecurityContext, id: string): Promise<void> {
    await this.inTenant(context, async (actor) => {
      const current = await this.deps.promotions.findById(actor.tenantId, id);
      if (!current) return this.deps.access.notFound(context, 'promocion', id);
      if (!current.isActive) {
        throw new ApplicationError(
          'conflict',
          'YA_DADO_DE_BAJA',
          'La promoción ya está dada de baja.',
        );
      }
      await this.deps.promotions.deactivate(actor.tenantId, id, actor.userId, actor.at);
      await this.record(actor, 'promocion_baja', id, current, { ...current, isActive: false });
    });
  }
}
