// Casos de uso de la cuota de descuento (T-124 a T-127; RF-063 a RF-067, RF-142, plan §2.11):
// el tope del AC, las cuotas que asigna el AS y el servicio que usará ventas para abrir el saldo
// del día y consumirlo dentro de su transacción.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { Action } from '../../../compartido/aplicacion/permissions.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import {
  adjustedBalance,
  assertNotSelfAssigned,
  assertWithinCap,
  checkDiscount,
  clampToCap,
  type DiscountRequest,
  type ExcessReason,
  normalizeLimits,
  type QuotaLimits,
  ZERO_LIMITS,
} from '../dominio/quota.js';

export type { DiscountRequest, QuotaLimits } from '../dominio/quota.js';

export interface QuotaKey {
  tenantId: string;
  userId: string;
  branchId: string;
}

export interface AssignedQuota extends QuotaKey {
  limits: QuotaLimits;
}

export interface DayBalance {
  journeyDate: string;
  balance: string;
}

export interface QuotaRepository {
  cap(tenantId: string): Promise<QuotaLimits | undefined>;
  saveCap(tenantId: string, cap: QuotaLimits, by: string, at: Date): Promise<void>;
  // Cuotas del comercio, bloqueadas hasta el fin de la transacción, para recortarlas (RF-142).
  lockAll(tenantId: string): Promise<AssignedQuota[]>;
  quota(key: QuotaKey, lock: boolean): Promise<QuotaLimits | undefined>;
  saveQuota(id: string, quota: AssignedQuota, by: string, at: Date): Promise<void>;
  branchQuotas(tenantId: string, branchId: string): Promise<Map<string, QuotaLimits>>;
  // Saldo de la última fecha de jornada de cada VO de la sucursal.
  latestBalances(tenantId: string, branchId: string): Promise<Map<string, DayBalance>>;
  // Último saldo del VO en la sucursal, bloqueado, para ajustarlo (D-73).
  lockLatestBalance(key: QuotaKey): Promise<(DayBalance & { id: string }) | undefined>;
  setBalance(tenantId: string, id: string, balance: string, at: Date): Promise<void>;
  // Crea el saldo de la fecha si no existe y devuelve el vigente (RF-067).
  openBalance(id: string, key: QuotaKey, day: DayBalance, at: Date): Promise<string>;
  // Descuenta del saldo solo si alcanza (AD-04). Devuelve el saldo resultante, o nada si no alcanza.
  consume(
    key: QuotaKey,
    journeyDate: string,
    amount: string,
    at: Date,
  ): Promise<string | undefined>;
}

export interface Seller {
  id: string;
  name: string;
  email: string;
}

export interface QuotaDirectory {
  branch(tenantId: string, branchId: string): Promise<{ id: string; name: string } | undefined>;
  // VO activos de la sucursal.
  sellers(tenantId: string, branchId: string): Promise<Seller[]>;
}

// Consumo de la autorización por PIN de un descuento fuera de cuota (RF-066). Lo implementa
// identidad.
export interface DiscountAuthorizations {
  consume(input: {
    id: string;
    type: 'descuento';
    operationRef: string;
    requesterId: string;
  }): Promise<void>;
}

export interface QuotaDependencies {
  uow: UnitOfWork;
  quotas: QuotaRepository;
  directory: QuotaDirectory;
  authorizations: DiscountAuthorizations;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
  ids: IdGenerator;
}

interface Actor {
  tenantId: string;
  userId: string;
  at: Date;
}

abstract class QuotaUseCase {
  constructor(protected readonly deps: QuotaDependencies) {}

  protected async inTenant<T>(
    context: SecurityContext,
    action: Action,
    work: (actor: Actor) => Promise<T>,
  ): Promise<T> {
    await this.deps.access.check(context, action);
    const tenantId = this.deps.access.requireTenant(context);
    return this.deps.uow.run(
      () => work({ tenantId, userId: context.userId, at: this.deps.clock.now() }),
      { tenantId },
    );
  }

  // Una sucursal que no es del comercio responde como inexistente (RF-002); una del comercio
  // fuera del ámbito del AS se rechaza por permiso (RF-004).
  protected async inBranch<T>(
    context: SecurityContext,
    branchId: string,
    work: (actor: Actor) => Promise<T>,
  ): Promise<T> {
    return this.inTenant(context, SELLER_QUOTAS, async (actor) => {
      const branch = await this.deps.directory.branch(actor.tenantId, branchId);
      if (!branch) return this.deps.access.notFound(context, 'sucursal', branchId);
      await this.deps.access.check(context, SELLER_QUOTAS, { branchId });
      return work(actor);
    });
  }

  protected async capOf(tenantId: string): Promise<QuotaLimits> {
    return (await this.deps.quotas.cap(tenantId)) ?? ZERO_LIMITS;
  }

  // Ajusta el saldo del día del VO por la diferencia del monto asignado (D-73).
  protected async adjustBalance(key: QuotaKey, previous: string, next: string, at: Date) {
    if (previous === next) return;
    const latest = await this.deps.quotas.lockLatestBalance(key);
    if (!latest) return;
    const balance = adjustedBalance(latest.balance, previous, next);
    if (balance !== latest.balance) {
      await this.deps.quotas.setBalance(key.tenantId, latest.id, balance, at);
    }
  }
}

const CAP = 'cuota.tope.gestionar' as const;
const SELLER_QUOTAS = 'clientes.gestionar' as const;

export class GetDiscountCap extends QuotaUseCase {
  async execute(context: SecurityContext): Promise<QuotaLimits> {
    return this.inTenant(context, CAP, (actor) => this.capOf(actor.tenantId));
  }
}

export interface CapResult {
  cap: QuotaLimits;
  // Cuotas recortadas al nuevo tope (RF-142).
  clamped: number;
}

export class SetDiscountCap extends QuotaUseCase {
  async execute(context: SecurityContext, limits: QuotaLimits): Promise<CapResult> {
    return this.inTenant(context, CAP, async (actor) => {
      const cap = normalizeLimits(limits);
      const before = await this.deps.quotas.cap(actor.tenantId);
      await this.deps.quotas.saveCap(actor.tenantId, cap, actor.userId, actor.at);
      await this.deps.audit.record({
        tenantId: actor.tenantId,
        userId: actor.userId,
        activeRole: 'AC',
        action: 'cuota_tope_modificado',
        entity: 'tope_cuota',
        entityId: actor.tenantId,
        before: before ?? null,
        after: cap,
      });
      let clamped = 0;
      for (const quota of await this.deps.quotas.lockAll(actor.tenantId)) {
        const next = clampToCap(quota.limits, cap);
        if (!next) continue;
        clamped++;
        await this.deps.quotas.saveQuota(
          this.deps.ids.next(),
          { ...quota, limits: next },
          actor.userId,
          actor.at,
        );
        await this.adjustBalance(quota, quota.limits.amount, next.amount, actor.at);
        await this.deps.audit.record({
          tenantId: actor.tenantId,
          branchId: quota.branchId,
          userId: actor.userId,
          activeRole: 'AC',
          action: 'cuota_vo_recortada',
          entity: 'cuota_vo',
          entityId: `${quota.userId}:${quota.branchId}`,
          before: quota.limits,
          after: next,
        });
      }
      return { cap, clamped };
    });
  }
}

export interface SellerQuota extends Seller {
  limits: QuotaLimits;
  assigned: boolean;
  // Saldo de su última fecha de jornada en la sucursal, si ya abrió algún turno.
  balance: DayBalance | null;
}

export interface BranchQuotas {
  cap: QuotaLimits;
  sellers: SellerQuota[];
}

export class ListSellerQuotas extends QuotaUseCase {
  async execute(context: SecurityContext, branchId: string): Promise<BranchQuotas> {
    return this.inBranch(context, branchId, async (actor) => {
      // En serie: comparten la conexión de la transacción.
      const cap = await this.capOf(actor.tenantId);
      const sellers = await this.deps.directory.sellers(actor.tenantId, branchId);
      const quotas = await this.deps.quotas.branchQuotas(actor.tenantId, branchId);
      const balances = await this.deps.quotas.latestBalances(actor.tenantId, branchId);
      return {
        cap,
        sellers: sellers.map((seller) => {
          const limits = quotas.get(seller.id);
          return {
            ...seller,
            limits: limits ?? ZERO_LIMITS,
            assigned: limits !== undefined,
            balance: balances.get(seller.id) ?? null,
          };
        }),
      };
    });
  }
}

export class SetSellerQuota extends QuotaUseCase {
  async execute(
    context: SecurityContext,
    branchId: string,
    sellerId: string,
    limits: QuotaLimits,
  ): Promise<SellerQuota> {
    return this.inBranch(context, branchId, async (actor) => {
      const seller = (await this.deps.directory.sellers(actor.tenantId, branchId)).find(
        (s) => s.id === sellerId,
      );
      if (!seller) {
        throw new DomainError(
          'VENDEDOR_INVALIDO',
          'La persona elegida no es un vendedor activo de esta sucursal.',
        );
      }
      assertNotSelfAssigned(actor.userId, sellerId);
      const quota = normalizeLimits(limits);
      assertWithinCap(quota, await this.capOf(actor.tenantId));
      const key = { tenantId: actor.tenantId, userId: sellerId, branchId };
      const before = await this.deps.quotas.quota(key, true);
      await this.deps.quotas.saveQuota(
        this.deps.ids.next(),
        { ...key, limits: quota },
        actor.userId,
        actor.at,
      );
      await this.adjustBalance(key, (before ?? ZERO_LIMITS).amount, quota.amount, actor.at);
      await this.deps.audit.record({
        tenantId: actor.tenantId,
        branchId,
        userId: actor.userId,
        activeRole: 'AS',
        action: 'cuota_vo_asignada',
        entity: 'cuota_vo',
        entityId: `${sellerId}:${branchId}`,
        before: before ?? null,
        after: quota,
      });
      const latest = (await this.deps.quotas.latestBalances(actor.tenantId, branchId)).get(
        sellerId,
      );
      return { ...seller, limits: quota, assigned: true, balance: latest ?? null };
    });
  }
}

export interface DiscountInput {
  branchId: string;
  // Fecha de jornada de la caja (D-13), en formato AAAA-MM-DD.
  journeyDate: string;
  discount: DiscountRequest;
  // Autorización por PIN para un descuento fuera de cuota (RF-066).
  authorization?: { id: string; operationRef: string } | null;
}

export interface DiscountResult {
  // Lo que se descontó del saldo: cero si el descuento se autorizó por PIN.
  consumed: string;
  balance: string;
  authorizationId: string | null;
}

// Servicio de cuota para ventas y turnos. Corre dentro de la transacción de quien lo llama, con
// el comercio ya fijado (plan §2.10): no abre su propia unidad de trabajo.
export class DiscountQuota {
  constructor(private readonly deps: QuotaDependencies) {}

  // Primer turno de una fecha de jornada en la sucursal: restablece el saldo al monto asignado.
  // Los turnos siguientes con la misma fecha lo conservan (RF-067).
  async openDay(actor: Actor, branchId: string, journeyDate: string): Promise<string> {
    const key = { tenantId: actor.tenantId, userId: actor.userId, branchId };
    const quota = (await this.deps.quotas.quota(key, false)) ?? ZERO_LIMITS;
    return this.deps.quotas.openBalance(
      this.deps.ids.next(),
      key,
      { journeyDate, balance: quota.amount },
      actor.at,
    );
  }

  // Controla un descuento contra la cuota sin consumirla, para el carrito (D-83).
  async check(
    actor: Actor,
    input: Pick<DiscountInput, 'branchId' | 'journeyDate' | 'discount'>,
  ): Promise<{ withinQuota: boolean; reasons: ExcessReason[] }> {
    const key = { tenantId: actor.tenantId, userId: actor.userId, branchId: input.branchId };
    const quota = (await this.deps.quotas.quota(key, false)) ?? ZERO_LIMITS;
    const balance = await this.openDay(actor, input.branchId, input.journeyDate);
    const check = checkDiscount(input.discount, quota, balance);
    return check.withinQuota ? { withinQuota: true, reasons: [] } : check;
  }

  // Aplica un descuento manual del VO (RF-065, RF-066). Dentro de la cuota, descuenta el saldo.
  // Fuera de ella, exige una autorización por PIN de otra persona; así autorizado no consume el
  // saldo y queda en la auditoría (D-34).
  async applyDiscount(actor: Actor, input: DiscountInput): Promise<DiscountResult> {
    const key = { tenantId: actor.tenantId, userId: actor.userId, branchId: input.branchId };
    const quota = (await this.deps.quotas.quota(key, false)) ?? ZERO_LIMITS;
    const balance = await this.openDay(actor, input.branchId, input.journeyDate);
    const check = checkDiscount(input.discount, quota, balance);
    let reasons: ExcessReason[] = check.withinQuota ? [] : check.reasons;
    if (check.withinQuota) {
      const left = await this.deps.quotas.consume(
        key,
        input.journeyDate,
        input.discount.amount,
        actor.at,
      );
      if (left !== undefined) {
        return { consumed: input.discount.amount, balance: left, authorizationId: null };
      }
      // Otra venta simultánea consumió el saldo (RF-152).
      reasons = ['saldo'];
    }

    const authorization = input.authorization ?? null;
    if (authorization === null) throw discountNeedsAuthorization(reasons);
    await this.deps.authorizations.consume({
      id: authorization.id,
      type: 'descuento',
      operationRef: authorization.operationRef,
      requesterId: actor.userId,
    });
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      branchId: input.branchId,
      userId: actor.userId,
      activeRole: 'VO',
      action: 'descuento_fuera_de_cuota',
      entity: 'venta',
      entityId: authorization.operationRef,
      after: { ...input.discount, motivos: reasons },
      authorizationId: authorization.id,
    });
    return {
      consumed: '0.00',
      balance: await this.openDay(actor, input.branchId, input.journeyDate),
      authorizationId: authorization.id,
    };
  }
}

function discountNeedsAuthorization(reasons: readonly ExcessReason[]): DomainError {
  const detail = reasons
    .map((r) => (r === 'porcentaje' ? 'supera tu porcentaje máximo por venta' : 'supera tu saldo'))
    .join(' y ');
  return new DomainError(
    'DESCUENTO_REQUIERE_AUTORIZACION',
    `El descuento ${detail}: pedí la autorización de un AS o AC.`,
  );
}
