// Casos de uso del POS (T-146 a T-160; RF-030, RF-031, RF-050 a RF-060, RF-076 a RF-080, RF-116,
// RF-143, RF-146, RF-153): carrito con reservas, totales del motor, descuento manual con cuota,
// confirmación atómica en efectivo, descarte, traspasos y vencimientos.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import { ApplicationError, forbiddenError } from '../../../compartido/aplicacion/errors.js';
import type { EventOutbox } from '../../../compartido/aplicacion/event-outbox.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { JobScheduler } from '../../../compartido/aplicacion/job-scheduler.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import type { PaymentGateway, RefundAlerts } from '../../cobros/aplicacion/gateway.js';
import {
  addQuantities,
  assertEditable,
  cartExpired,
  componentQuantity,
  type DiscardReason,
  discountReference,
  idleUntil,
  isPositive,
  type ManualDiscountInput,
  negate,
  normalizeDiscount,
  normalizeQuantity,
  quantityDelta,
  transferExpired,
} from '../dominio/sales.js';
import type {
  Actor,
  CatalogEntry,
  OpenShift,
  Payment,
  Sale,
  SaleAuthorizations,
  SaleCash,
  SaleCustomer,
  SaleCustomers,
  SaleItem,
  SalePromotions,
  SaleQuota,
  SalesCatalog,
  SaleSettings,
  SaleShifts,
  SalesRepository,
  SaleStock,
  SearchResult,
  Transfer,
} from './ports.js';
import { type PricedCart, priceCart } from './pricing.js';

export const CART_EXPIRATION_JOB = 'ventas.vencer_carrito';
export const TRANSFER_EXPIRATION_JOB = 'ventas.vencer_traspaso';

export interface SalesDependencies {
  uow: UnitOfWork;
  sales: SalesRepository;
  catalog: SalesCatalog;
  promotions: SalePromotions;
  stock: SaleStock;
  shifts: SaleShifts;
  cash: SaleCash;
  quota: SaleQuota;
  authorizations: SaleAuthorizations;
  settings: SaleSettings;
  customers: SaleCustomers;
  gateway: PaymentGateway;
  alerts: RefundAlerts;
  jobs: JobScheduler;
  outbox: EventOutbox;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
  ids: IdGenerator;
}

export interface CartView {
  sale: Sale;
  priced: PricedCart;
  transfer: Transfer | null;
  payments: Payment[];
  customer: SaleCustomer | null;
}

export interface Receipt {
  sale: Sale;
  priced: PricedCart;
  payments: Payment[];
  customer: SaleCustomer | null;
  charged: string;
  adjustment: string;
  tendered: string;
  change: string;
}

const OPERATE = 'ventas.operar' as const;

export const LIVE_STATES: ReadonlySet<Payment['state']> = new Set([
  'pendiente',
  'aprobado',
  'por_verificar',
  'revirtiendo',
]);

// La base de todos los casos de uso del POS: permiso, comercio, transacción y venta propia.
export abstract class SalesUseCase {
  constructor(protected readonly deps: SalesDependencies) {}

  protected async inTenant<T>(
    context: SecurityContext,
    work: (actor: Actor) => Promise<T>,
  ): Promise<T> {
    await this.deps.access.check(context, OPERATE);
    const tenantId = this.deps.access.requireTenant(context);
    return this.deps.uow.run(
      () => work({ tenantId, userId: context.userId, at: this.deps.clock.now() }),
      { tenantId },
    );
  }

  // Una venta de otro comercio responde como inexistente (RF-002); la de otro VO, sin permiso.
  protected async ownSale(context: SecurityContext, actor: Actor, id: string): Promise<Sale> {
    const sale = await this.deps.sales.find(actor.tenantId, id, true);
    if (!sale) return this.deps.access.notFound(context, 'venta', id);
    if (sale.sellerId !== actor.userId) throw forbiddenError();
    return sale;
  }

  // Venta en curso propia, sin un traspaso pendiente.
  protected async openSale(context: SecurityContext, actor: Actor, id: string) {
    const sale = await this.ownSale(context, actor, id);
    const transfer = await this.deps.sales.pendingTransfer(actor.tenantId, sale.id);
    assertEditable(sale.state, transfer !== undefined);
    return sale;
  }

  // Con un pago aprobado o sin resultado, el carrito queda fijo hasta revertirlo (D-85).
  protected async editableSale(context: SecurityContext, actor: Actor, id: string) {
    const sale = await this.openSale(context, actor, id);
    if (await this.deps.sales.hasLivePayments(actor.tenantId, sale.id)) {
      throw new DomainError(
        'CARRITO_BLOQUEADO',
        'La venta tiene un pago electrónico: revertilo antes de modificarla.',
      );
    }
    return sale;
  }

  protected async view(actor: Actor, sale: Sale): Promise<CartView> {
    const items = await this.deps.sales.items(actor.tenantId, sale.id);
    const payments = await this.deps.sales.paymentsOf(actor.tenantId, sale.id);
    const priced = priceCart(
      items,
      sale.discount,
      await this.deps.promotions.all(actor.tenantId),
      sale.branchId,
      actor.at,
      payments.some((p) => LIVE_STATES.has(p.state)) || sale.state === 'confirmada',
    );
    return {
      sale,
      priced,
      transfer: (await this.deps.sales.pendingTransfer(actor.tenantId, sale.id)) ?? null,
      payments,
      customer:
        sale.customerId === null
          ? null
          : ((await this.deps.customers.find(actor.tenantId, sale.customerId)) ?? null),
    };
  }

  // Recalcula y guarda los totales después de un cambio, y renueva la actividad del carrito.
  protected async reprice(actor: Actor, sale: Sale, discount = sale.discount): Promise<CartView> {
    const view = await this.view(actor, { ...sale, discount });
    const priced = view.priced;
    for (const item of priced.items) await this.deps.sales.saveItem(actor.tenantId, item);
    // Una autorización vale por el monto autorizado: si el descuento cambia, se pierde.
    const authorizationId =
      sale.discountAuthorizationId !== null && priced.manualDiscount === sale.manualDiscount
        ? sale.discountAuthorizationId
        : null;
    const next: Sale = {
      ...sale,
      discount,
      discountAuthorizationId: discount === null ? null : authorizationId,
      subtotal: priced.subtotal,
      promoDiscount: priced.promoDiscount,
      manualDiscount: priced.manualDiscount,
      total: priced.total,
      lastActivity: actor.at,
    };
    await this.deps.sales.save(next);
    return { ...view, sale: next };
  }

  // Pasa stock entre disponible y reservado o lo consume. En un combo, cada componente (RF-051).
  protected async moveStock(
    actor: Actor,
    sale: Sale,
    item: Pick<SaleItem, 'productId' | 'name' | 'type' | 'components'>,
    operation: 'reservar' | 'liberar' | 'consumir',
    quantity: string,
  ) {
    const targets =
      item.type === 'combo'
        ? item.components.map((c) => ({
            product: { id: c.productId, name: c.name },
            quantity: componentQuantity(c.quantity, quantity),
          }))
        : [{ product: { id: item.productId, name: item.name }, quantity }];
    for (const target of targets) {
      try {
        await this.deps.stock.apply(actor, {
          branchId: sale.branchId,
          product: target.product,
          operation,
          quantity: target.quantity,
          reference: sale.id,
        });
      } catch (error: unknown) {
        if (
          operation === 'reservar' &&
          error instanceof DomainError &&
          error.code === 'STOCK_INSUFICIENTE'
        ) {
          // Todo o nada (RF-055): la transacción se revierte entera e informa el disponible (RF-056).
          const available = await this.deps.catalog.available(
            actor.tenantId,
            sale.branchId,
            target.product.id,
          );
          throw new DomainError(
            'STOCK_INSUFICIENTE',
            `No hay stock suficiente de «${target.product.name}»: hay ${trimQuantity(available)} disponible(s).`,
          );
        }
        throw error;
      }
    }
  }

  protected async releaseAll(actor: Actor, sale: Sale) {
    for (const item of await this.deps.sales.items(actor.tenantId, sale.id)) {
      await this.moveStock(actor, sale, item, 'liberar', item.quantity);
    }
  }

  protected async discard(
    actor: Actor,
    sale: Sale,
    reason: DiscardReason,
    role: 'VO' | 'AS' | 'AC',
  ) {
    await this.releaseAll(actor, sale);
    const next: Sale = {
      ...sale,
      state: 'descartada',
      discardReason: reason,
      lastActivity: actor.at,
    };
    await this.deps.sales.save(next);
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      branchId: sale.branchId,
      userId: actor.userId,
      activeRole: role,
      action: 'venta_descartada',
      entity: 'venta',
      entityId: sale.id,
      after: { motivo: reason, total: sale.total },
    });
    return next;
  }

  protected async scheduleExpiration(sale: Pick<Sale, 'id' | 'tenantId'>, runAt: Date) {
    await this.deps.jobs.schedule({
      type: CART_EXPIRATION_JOB,
      key: `${sale.id}:${runAt.toISOString()}`,
      runAt,
      payload: { tenantId: sale.tenantId, saleId: sale.id },
    });
  }
}

const trimQuantity = (value: string) => String(Number(value));

export class StartSale extends SalesUseCase {
  async execute(context: SecurityContext): Promise<CartView> {
    return this.inTenant(context, async (actor) => {
      const shift = await this.deps.shifts.openShiftOf(actor.tenantId, actor.userId);
      if (!shift) {
        throw new DomainError('SIN_TURNO', 'Abrí un turno en una caja para poder vender.');
      }
      const sale: Sale = {
        id: this.deps.ids.next(),
        tenantId: actor.tenantId,
        branchId: shift.branchId,
        registerId: shift.registerId,
        shiftId: shift.id,
        sellerId: actor.userId,
        ticket: null,
        state: 'en_curso',
        paymentState: null,
        fiscalState: null,
        billed: null,
        subtotal: '0.00',
        promoDiscount: '0.00',
        manualDiscount: '0.00',
        total: '0.00',
        discount: null,
        discountAuthorizationId: null,
        createdAt: actor.at,
        lastActivity: actor.at,
        confirmedAt: null,
        discardReason: null,
        customerId: null,
        creditAuthorizationId: null,
      };
      await this.deps.sales.insert(sale);
      const idle = await this.deps.settings.cartIdleMinutes(actor.tenantId);
      await this.scheduleExpiration(sale, idleUntil(actor.at, idle));
      return this.view(actor, sale);
    });
  }
}

export interface OwnSales {
  sales: CartView[];
  // Traspasos que otros VO le enviaron y esperan respuesta.
  incoming: Transfer[];
}

export class ListOwnSales extends SalesUseCase {
  async execute(context: SecurityContext): Promise<OwnSales> {
    return this.inTenant(context, async (actor) => {
      const sales = await this.deps.sales.inProgressOfSeller(actor.tenantId, actor.userId);
      const views: CartView[] = [];
      for (const sale of sales) views.push(await this.view(actor, sale));
      return {
        sales: views,
        incoming: await this.deps.sales.pendingTransfersTo(actor.tenantId, actor.userId),
      };
    });
  }
}

export class GetSale extends SalesUseCase {
  async execute(context: SecurityContext, id: string): Promise<CartView> {
    return this.inTenant(context, async (actor) =>
      this.view(actor, await this.ownSale(context, actor, id)),
    );
  }
}

// Búsqueda por nombre o por código de barras en la sucursal del turno (RF-054).
export class SearchProducts extends SalesUseCase {
  async execute(context: SecurityContext, query: string): Promise<SearchResult[]> {
    return this.inTenant(context, async (actor) => {
      const text = query.trim();
      if (text.length === 0) return [];
      const shift = await this.deps.shifts.openShiftOf(actor.tenantId, actor.userId);
      const branchId = shift?.branchId ?? context.branchIds[0];
      if (branchId === undefined) return [];
      return this.deps.catalog.search(actor.tenantId, branchId, text.slice(0, 60));
    });
  }
}

export class AddItem extends SalesUseCase {
  async execute(
    context: SecurityContext,
    saleId: string,
    input: { productId: string; quantity: string },
  ): Promise<CartView> {
    return this.inTenant(context, async (actor) => {
      const sale = await this.editableSale(context, actor, saleId);
      const entry = await this.deps.catalog.product(actor.tenantId, sale.branchId, input.productId);
      sellable(entry);
      const quantity = normalizeQuantity(input.quantity, entry.type === 'combo');
      const items = await this.deps.sales.items(actor.tenantId, sale.id);
      const existing = items.find((i) => i.productId === entry.id);
      if (existing) {
        // El mismo producto suma a su ítem, que conserva el precio fijado (RF-031, D-84).
        await this.moveStock(actor, sale, existing, 'reservar', quantity);
        await this.deps.sales.saveItem(actor.tenantId, {
          ...existing,
          quantity: addQuantities(existing.quantity, quantity),
        });
      } else {
        const item: SaleItem = {
          id: this.deps.ids.next(),
          saleId: sale.id,
          productId: entry.id,
          type: entry.type,
          name: entry.name,
          categoryId: entry.categoryId,
          quantity,
          // Precio de la lista activa de la sucursal en este momento (RF-030).
          fixedPrice: entry.price,
          vatRate: entry.type === 'combo' ? null : entry.vatRate,
          promotionId: null,
          promoDiscount: '0.00',
          manualDiscount: '0.00',
          final: '0.00',
          components: entry.components,
        };
        await this.moveStock(actor, sale, item, 'reservar', quantity);
        await this.deps.sales.addItem(actor.tenantId, item, actor.at);
      }
      return this.reprice(actor, sale);
    });
  }
}

function sellable(
  entry: CatalogEntry | undefined,
): asserts entry is CatalogEntry & { price: string } {
  if (!entry?.isActive) {
    throw new DomainError('PRODUCTO_INVALIDO', 'El producto no existe o está dado de baja.');
  }
  if (entry.price === null) {
    throw new DomainError(
      'SIN_PRECIO',
      `«${entry.name}» no tiene precio en la lista de la sucursal.`,
    );
  }
}

export class UpdateItemQuantity extends SalesUseCase {
  async execute(
    context: SecurityContext,
    saleId: string,
    itemId: string,
    quantityText: string,
  ): Promise<CartView> {
    return this.inTenant(context, async (actor) => {
      const sale = await this.editableSale(context, actor, saleId);
      const item = await this.item(context, actor, sale, itemId);
      const quantity = normalizeQuantity(quantityText, item.type === 'combo');
      const delta = quantityDelta(item.quantity, quantity);
      if (isPositive(delta)) await this.moveStock(actor, sale, item, 'reservar', delta);
      else if (isPositive(negate(delta))) {
        await this.moveStock(actor, sale, item, 'liberar', negate(delta));
      }
      await this.deps.sales.saveItem(actor.tenantId, { ...item, quantity });
      return this.reprice(actor, sale);
    });
  }

  private async item(context: SecurityContext, actor: Actor, sale: Sale, itemId: string) {
    const item = (await this.deps.sales.items(actor.tenantId, sale.id)).find(
      (i) => i.id === itemId,
    );
    if (!item) return this.deps.access.notFound(context, 'venta_item', itemId);
    return item;
  }
}

// Quitar un ítem libera su reserva en el acto (RF-058).
export class RemoveItem extends SalesUseCase {
  async execute(context: SecurityContext, saleId: string, itemId: string): Promise<CartView> {
    return this.inTenant(context, async (actor) => {
      const sale = await this.editableSale(context, actor, saleId);
      const item = (await this.deps.sales.items(actor.tenantId, sale.id)).find(
        (i) => i.id === itemId,
      );
      if (!item) return this.deps.access.notFound(context, 'venta_item', itemId);
      await this.moveStock(actor, sale, item, 'liberar', item.quantity);
      await this.deps.sales.removeItem(actor.tenantId, item.id, actor.at);
      return this.reprice(actor, sale);
    });
  }
}

// Descuento manual (RF-065, RF-066, D-70, D-83): se controla contra la cuota sin consumirla; si la
// supera, exige una autorización por PIN ligada a la venta. El saldo se consume al confirmar.
export class SetManualDiscount extends SalesUseCase {
  async execute(
    context: SecurityContext,
    saleId: string,
    input: { discount: ManualDiscountInput | null; authorizationId: string | null },
  ): Promise<CartView> {
    return this.inTenant(context, async (actor) => {
      const sale = await this.editableSale(context, actor, saleId);
      if (input.discount === null)
        return this.reprice(actor, { ...sale, discountAuthorizationId: null }, null);
      const discount = normalizeDiscount(input.discount);
      const priced = (await this.view(actor, { ...sale, discount })).priced;
      const shift = await this.shiftOf(actor, sale);
      const check = await this.deps.quota.check(actor, {
        branchId: sale.branchId,
        journeyDate: shift.journeyDate,
        discount: quotaDiscount(priced, discount),
      });
      let authorizationId: string | null = null;
      if (!check.withinQuota) {
        if (input.authorizationId === null) {
          throw new DomainError(
            'DESCUENTO_REQUIERE_AUTORIZACION',
            'El descuento supera tu cuota: pedí la autorización de un AS o AC.',
          );
        }
        await this.deps.authorizations.consume({
          id: input.authorizationId,
          type: 'descuento',
          operationRef: discountReference(sale.id),
          requesterId: actor.userId,
        });
        authorizationId = input.authorizationId;
      }
      const view = await this.reprice(actor, { ...sale, discountAuthorizationId: null }, discount);
      if (authorizationId === null) return view;
      const next = { ...view.sale, discountAuthorizationId: authorizationId };
      await this.deps.sales.save(next);
      return { ...view, sale: next };
    });
  }

  private async shiftOf(actor: Actor, sale: Sale): Promise<OpenShift> {
    const shift = await this.deps.shifts.openShiftOf(actor.tenantId, actor.userId);
    if (shift?.id !== sale.shiftId) {
      throw new DomainError('SIN_TURNO', 'La venta no pertenece a tu turno abierto.');
    }
    return shift;
  }
}

function quotaDiscount(priced: PricedCart, discount: ManualDiscountInput) {
  return {
    subtotal: priced.subtotal,
    amount: priced.manualDiscount,
    enteredPercent: discount.type === 'porcentaje' ? discount.value : null,
  };
}

// Descarte manual (RF-058, RF-116): libera las reservas y conserva la venta con su motivo.
export class DiscardSale extends SalesUseCase {
  async execute(context: SecurityContext, saleId: string): Promise<Sale> {
    return this.inTenant(context, async (actor) => {
      const sale = await this.openSale(context, actor, saleId);
      // RF-125: los pagos aprobados se revierten antes de descartar.
      if (await this.deps.sales.hasLivePayments(actor.tenantId, sale.id)) {
        throw new DomainError(
          'PAGOS_POR_REVERTIR',
          'La venta tiene pagos electrónicos: revertilos antes de descartarla.',
        );
      }
      return this.discard(actor, sale, 'manual', 'VO');
    });
  }
}

export class ListTransferTargets extends SalesUseCase {
  async execute(context: SecurityContext, saleId: string): Promise<{ id: string; name: string }[]> {
    return this.inTenant(context, async (actor) => {
      const sale = await this.ownSale(context, actor, saleId);
      const sellers = await this.deps.shifts.sellersWithOpenShift(actor.tenantId, sale.branchId);
      return sellers.filter((s) => s.id !== actor.userId);
    });
  }
}

// Traspaso a otro VO con turno abierto en la misma sucursal (RF-077). Mientras está pendiente, la
// venta sigue siendo del emisor y no se modifica.
export class SendTransfer extends SalesUseCase {
  async execute(context: SecurityContext, saleId: string, receiverId: string): Promise<Transfer> {
    return this.inTenant(context, async (actor) => {
      const sale = await this.editableSale(context, actor, saleId);
      if (receiverId === actor.userId) {
        throw new DomainError('TRASPASO_INVALIDO', 'Elegí a otro vendedor.');
      }
      const receiverShift = await this.deps.shifts.openShiftOf(actor.tenantId, receiverId);
      if (receiverShift?.branchId !== sale.branchId) {
        throw new DomainError(
          'TRASPASO_INVALIDO',
          'El vendedor elegido no tiene un turno abierto en esta sucursal.',
        );
      }
      const own = await this.deps.shifts.openShiftOf(actor.tenantId, actor.userId);
      const idle = await this.deps.settings.cartIdleMinutes(actor.tenantId);
      const transfer: Transfer = {
        id: this.deps.ids.next(),
        saleId: sale.id,
        senderId: actor.userId,
        senderName: own?.sellerName ?? '',
        receiverId,
        receiverName: receiverShift.sellerName,
        state: 'pendiente',
        createdAt: actor.at,
        expiresAt: idleUntil(actor.at, idle),
      };
      await this.deps.sales.insertTransfer(actor.tenantId, transfer);
      await this.deps.sales.save({ ...sale, lastActivity: actor.at });
      await this.deps.jobs.schedule({
        type: TRANSFER_EXPIRATION_JOB,
        key: transfer.id,
        runAt: transfer.expiresAt,
        payload: { tenantId: actor.tenantId, transferId: transfer.id },
      });
      return transfer;
    });
  }
}

abstract class TransferAnswer extends SalesUseCase {
  protected async pending(context: SecurityContext, actor: Actor, id: string) {
    const transfer = await this.deps.sales.findTransfer(actor.tenantId, id, true);
    if (!transfer) return this.deps.access.notFound(context, 'traspaso', id);
    if (transfer.receiverId !== actor.userId) throw forbiddenError();
    if (transfer.state !== 'pendiente') {
      throw new ApplicationError('conflict', 'TRASPASO_RESUELTO', 'El traspaso ya fue resuelto.');
    }
    if (transferExpired(transfer.expiresAt, actor.at)) {
      await this.deps.sales.resolveTransfer(actor.tenantId, transfer.id, 'vencido', actor.at);
      return null;
    }
    return transfer;
  }
}

// El receptor acepta: la venta y sus reservas pasan a su turno sin liberarse (RF-078).
export class AcceptTransfer extends TransferAnswer {
  async execute(context: SecurityContext, id: string): Promise<CartView> {
    const result = await this.inTenant(context, async (actor) => {
      const transfer = await this.pending(context, actor, id);
      if (!transfer) return null;
      const shift = await this.deps.shifts.openShiftOf(actor.tenantId, actor.userId);
      const sale = await this.deps.sales.find(actor.tenantId, transfer.saleId, true);
      if (!sale || shift?.branchId !== sale.branchId) {
        throw new DomainError(
          'SIN_TURNO',
          'Abrí un turno en la sucursal para aceptar el traspaso.',
        );
      }
      await this.deps.sales.resolveTransfer(actor.tenantId, transfer.id, 'aceptado', actor.at);
      const next: Sale = {
        ...sale,
        sellerId: actor.userId,
        shiftId: shift.id,
        registerId: shift.registerId,
        lastActivity: actor.at,
      };
      await this.deps.sales.save(next);
      await this.deps.audit.record({
        tenantId: actor.tenantId,
        branchId: sale.branchId,
        userId: actor.userId,
        activeRole: 'VO',
        action: 'traspaso_aceptado',
        entity: 'venta',
        entityId: sale.id,
        before: { vendedorId: sale.sellerId, turnoId: sale.shiftId },
        after: { vendedorId: actor.userId, turnoId: shift.id },
      });
      return this.view(actor, next);
    });
    if (!result) {
      throw new DomainError(
        'TRASPASO_VENCIDO',
        'El traspaso venció y la venta volvió a quien la envió.',
      );
    }
    return result;
  }
}

// El receptor rechaza: la venta vuelve al emisor (RF-079).
export class RejectTransfer extends TransferAnswer {
  async execute(context: SecurityContext, id: string): Promise<void> {
    await this.inTenant(context, async (actor) => {
      const transfer = await this.pending(context, actor, id);
      if (!transfer) return;
      await this.deps.sales.resolveTransfer(actor.tenantId, transfer.id, 'rechazado', actor.at);
      const sale = await this.deps.sales.find(actor.tenantId, transfer.saleId, true);
      if (sale) await this.deps.sales.save({ ...sale, lastActivity: actor.at });
    });
  }
}

// Mantenimiento sin sesión: vencimientos (RF-059, RF-079), suspensión del comercio (RF-146) y
// ventas en curso de un turno para la caja (RF-115, RF-117). Corre con el comercio fijado.
export class SalesMaintenance extends SalesUseCase {
  // Trabajo programado por venta: si el carrito sigue inactivo lo descarta; si no, se reprograma.
  async expireCart(tenantId: string, saleId: string): Promise<void> {
    await this.deps.uow.run(
      async () => {
        const sale = await this.deps.sales.find(tenantId, saleId, true);
        if (sale?.state !== 'en_curso') return;
        const actor: Actor = { tenantId, userId: sale.sellerId, at: this.deps.clock.now() };
        const idle = await this.deps.settings.cartIdleMinutes(tenantId);
        const live = await this.deps.sales.hasLivePayments(tenantId, sale.id);
        const pending = await this.deps.sales.pendingTransfer(tenantId, sale.id);
        if (
          pending === undefined &&
          cartExpired(sale.state, sale.lastActivity, idle, actor.at, live)
        ) {
          await this.discard(actor, sale, 'inactividad', 'VO');
          return;
        }
        if (live) return;
        const next = idleUntil(sale.lastActivity, idle);
        await this.scheduleExpiration(
          sale,
          next.getTime() > actor.at.getTime() ? next : idleUntil(actor.at, idle),
        );
      },
      { tenantId },
    );
  }

  async expireTransfer(tenantId: string, transferId: string): Promise<void> {
    await this.deps.uow.run(
      async () => {
        const transfer = await this.deps.sales.findTransfer(tenantId, transferId, true);
        const now = this.deps.clock.now();
        if (transfer?.state !== 'pendiente' || !transferExpired(transfer.expiresAt, now)) return;
        await this.deps.sales.resolveTransfer(tenantId, transfer.id, 'vencido', now);
      },
      { tenantId },
    );
  }

  // Suspensión del comercio: descarta sus carritos y libera las reservas. Idempotente.
  async discardForSuspension(tenantId: string): Promise<number> {
    return this.deps.uow.run(
      async () => {
        const sales = await this.deps.sales.inProgressOfTenant(tenantId);
        const now = this.deps.clock.now();
        let discarded = 0;
        for (const sale of sales) {
          // Una venta con pagos no se descarta sin revertirlos (RF-125): se conserva.
          if (await this.deps.sales.hasLivePayments(tenantId, sale.id)) continue;
          await this.discard(
            { tenantId, userId: sale.sellerId, at: now },
            sale,
            'suspension',
            'VO',
          );
          discarded += 1;
        }
        return discarded;
      },
      { tenantId },
    );
  }

  async inProgressOfShift(tenantId: string, shiftId: string) {
    return labels(await this.deps.sales.inProgressOfShift(tenantId, shiftId));
  }

  async inProgressOfRegister(tenantId: string, registerId: string) {
    return labels(await this.deps.sales.inProgressOfRegister(tenantId, registerId));
  }

  // Cierre forzado de un turno: sus ventas en curso se descartan (RF-115).
  async discardForShift(actor: Actor & { role: 'AS' }, shiftId: string): Promise<void> {
    for (const sale of await this.deps.sales.inProgressOfShift(actor.tenantId, shiftId)) {
      const locked = await this.deps.sales.find(actor.tenantId, sale.id, true);
      if (!locked) continue;
      if (await this.deps.sales.hasLivePayments(actor.tenantId, locked.id)) {
        throw new DomainError(
          'PAGOS_POR_REVERTIR',
          'El turno tiene una venta con pagos electrónicos: resolvelos antes de cerrarlo.',
        );
      }
      await this.discard(actor, locked, 'cierre_forzado', 'AS');
    }
  }

  // El estado fiscal lo informa la cola de comprobantes (RF-153).
  async setFiscalState(tenantId: string, saleId: string, state: Sale['fiscalState']) {
    const sale = await this.deps.sales.find(tenantId, saleId, true);
    if (sale) await this.deps.sales.save({ ...sale, fiscalState: state });
  }

  // Facturación posterior: la venta confirmada pasa a facturarse (RF-168).
  async markBilled(tenantId: string, saleId: string) {
    const sale = await this.deps.sales.find(tenantId, saleId, true);
    if (sale) await this.deps.sales.save({ ...sale, billed: true, fiscalState: 'pendiente' });
  }

  async inProgressOfSeller(tenantId: string, sellerId: string) {
    return labels(await this.deps.sales.inProgressOfSeller(tenantId, sellerId));
  }
}

// Cómo se nombra una venta en curso en los rechazos de la caja y del cierre de sesión.
function labels(sales: readonly Sale[]) {
  return sales.map((s) => ({
    id: s.id,
    label: `venta ${s.id.slice(0, 8)} por $ ${s.total}`,
  }));
}
