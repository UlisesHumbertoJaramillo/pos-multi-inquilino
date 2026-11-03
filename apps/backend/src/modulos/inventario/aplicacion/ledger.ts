// Servicio de inventario (T-089, T-092; RF-039, RF-041, RF-152). Es el único que modifica los
// saldos de stock: los demás módulos (ventas, compras, devoluciones) lo llaman dentro de la
// transacción de su caso de uso (plan §2.7, AD-04).
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { Action } from '../../../compartido/aplicacion/permissions.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import {
  insufficientStock,
  OPERATIONS,
  type OperationName,
  type StockBalance,
  thresholdTransition,
} from '../dominio/stock.js';
import type {
  AlertRepository,
  BranchDirectory,
  CatalogProduct,
  MovementQuery,
  ProductCatalog,
  StockRepository,
  TransferRepository,
} from './ports.js';

export interface InventoryDependencies {
  uow: UnitOfWork;
  stock: StockRepository;
  movements: MovementQuery;
  transfers: TransferRepository;
  alerts: AlertRepository;
  catalog: ProductCatalog;
  branches: BranchDirectory;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
  ids: IdGenerator;
}

export interface Actor {
  tenantId: string;
  userId: string;
  at: Date;
}

export interface StockRequest {
  branchId: string;
  product: Pick<CatalogProduct, 'id' | 'name'>;
  operation: OperationName;
  quantity: string;
  reference?: string | null;
  reason?: string | null;
}

export const STOCK_ALERT = 'stock_minimo';

export class StockLedger {
  constructor(
    private readonly stock: StockRepository,
    private readonly alerts: AlertRepository,
  ) {}

  // Aplica una operación atómica. Si el saldo de origen no alcanza, no cambia nada y lo informa.
  async apply(actor: Actor, request: StockRequest): Promise<StockBalance> {
    const operation = OPERATIONS[request.operation];
    const balance = await this.stock.apply({
      tenantId: actor.tenantId,
      branchId: request.branchId,
      productId: request.product.id,
      operation,
      quantity: request.quantity,
      reference: request.reference ?? null,
      reason: request.reason ?? null,
      userId: actor.userId,
      at: actor.at,
    });
    if (!balance) {
      throw insufficientStock(operation.from ?? 'disponible', request.product.name);
    }
    if (operation.from === 'disponible' || operation.to === 'disponible') {
      return {
        ...balance,
        alertActive: await this.checkThreshold(actor, request.branchId, request.product, balance),
      };
    }
    return balance;
  }

  // Emite la alerta al quedar por debajo del umbral y la resuelve al reponer (RF-041, D-51).
  // La marca se cambia con una actualización condicional: dos operaciones simultáneas no emiten
  // dos alertas por el mismo cruce. Devuelve la marca resultante.
  async checkThreshold(
    actor: Actor,
    branchId: string,
    product: Pick<CatalogProduct, 'id' | 'name'>,
    balance: StockBalance,
  ): Promise<boolean> {
    const transition = thresholdTransition(balance.available, balance.minimum, balance.alertActive);
    if (transition === 'none') return balance.alertActive;
    const emit = transition === 'emit';
    const changed = await this.stock.setAlertActive(actor.tenantId, branchId, product.id, emit);
    if (!changed) return emit;
    if (emit) {
      await this.alerts.add({
        tenantId: actor.tenantId,
        branchId,
        recipientRole: 'AS',
        type: STOCK_ALERT,
        severity: 'advertencia',
        reference: product.id,
        detail: { producto: product.name, disponible: balance.available, umbral: balance.minimum },
        at: actor.at,
      });
    } else {
      await this.alerts.resolve(
        actor.tenantId,
        branchId,
        STOCK_ALERT,
        product.id,
        actor.userId,
        actor.at,
      );
    }
    return emit;
  }
}

// Base de los casos de uso del inventario: permiso, sucursal del ámbito, unidad de trabajo y
// auditoría comercial.
export abstract class InventoryUseCase {
  protected readonly ledger: StockLedger;

  constructor(protected readonly deps: InventoryDependencies) {
    this.ledger = new StockLedger(deps.stock, deps.alerts);
  }

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
  protected async branch(
    context: SecurityContext,
    action: Action,
    actor: Actor,
    branchId: string,
    scoped = true,
  ): Promise<{ id: string; name: string }> {
    const found = await this.deps.branches.find(actor.tenantId, branchId);
    if (!found) return this.deps.access.notFound(context, 'sucursal', branchId);
    if (scoped) await this.deps.access.check(context, action, { branchId });
    return found;
  }

  protected async inBranch<T>(
    context: SecurityContext,
    action: Action,
    branchId: string,
    work: (actor: Actor, branch: { id: string; name: string }) => Promise<T>,
  ): Promise<T> {
    return this.inTenant(context, action, async (actor) =>
      work(actor, await this.branch(context, action, actor, branchId)),
    );
  }

  // Un producto simple del comercio. Los combos no tienen stock propio (S-3).
  protected async stockable(
    context: SecurityContext,
    actor: Actor,
    productId: string,
    requireActive = true,
  ): Promise<CatalogProduct> {
    const [product] = await this.deps.catalog.products(actor.tenantId, [productId]);
    if (!product) return this.deps.access.notFound(context, 'producto', productId);
    if (product.type === 'combo') {
      throw new DomainError(
        'ES_UN_COMBO',
        'Un combo no tiene stock propio: se usa el de sus componentes.',
      );
    }
    if (requireActive && !product.isActive) {
      throw new DomainError('PRODUCTO_DADO_DE_BAJA', `«${product.name}» está dado de baja.`);
    }
    return product;
  }

  protected async record(
    actor: Actor,
    branchId: string,
    action: string,
    entity: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ) {
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      branchId,
      userId: actor.userId,
      activeRole: 'AS',
      action,
      entity,
      entityId,
      before,
      after,
    });
  }
}
