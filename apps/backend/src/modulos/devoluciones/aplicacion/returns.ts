// Devoluciones y anulaciones (T-215 a T-224; RF-081 a RF-087, RF-136 a RF-140, RF-169, D-4,
// D-27 a D-31, D-89). Los reintegros electrónicos van a la pasarela fuera de toda transacción:
// primero se reservan las cantidades, después se pide el reintegro y al final se aplica todo o se
// libera lo reservado.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import { notFoundError } from '../../../compartido/aplicacion/errors.js';
import type { EventOutbox } from '../../../compartido/aplicacion/event-outbox.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import {
  type Cents,
  cents,
  creditRefund,
  money,
  refundByFraction,
  returnedLineValue,
} from '../../calculo/aplicacion/engine.js';
import { askRefund, type PaymentGateway } from '../../cobros/aplicacion/gateway.js';
import {
  assertReturnWindow,
  assertVoidable,
  componentQuantity,
  refundReference,
  voidReference,
} from '../dominio/returns.js';
import type {
  Actor,
  RefundRecord,
  ReturnAuthorizations,
  ReturnCredit,
  ReturnItem,
  ReturnPayment,
  ReturnRepository,
  ReturnSale,
  ReturnSalesState,
  ReturnSettings,
  ReturnShifts,
  ReturnStock,
  UncertainRefunds,
} from './ports.js';

const OPERATE = 'devoluciones.iniciar' as const;

export interface ReturnDependencies {
  uow: UnitOfWork;
  returns: ReturnRepository;
  settings: ReturnSettings;
  shifts: ReturnShifts;
  sales: ReturnSalesState;
  stock: ReturnStock;
  credit: ReturnCredit & { freeBalance(tenantId: string, customerId: string): Promise<string> };
  gateway: PaymentGateway;
  authorizations: ReturnAuthorizations;
  uncertain: UncertainRefunds;
  outbox: EventOutbox;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
  ids: IdGenerator;
}

class Rejection {
  constructor(readonly error: Error) {}
}

export interface RefundPart {
  payment: ReturnPayment;
  amount: string;
}

export interface ReturnPlan {
  items: { item: ReturnItem; quantity: string; amount: string }[];
  value: string;
  refund: string;
  parts: RefundPart[];
  // Efectivo a pagar: las fracciones en efectivo más el excedente de la cuenta corriente (D-29).
  cash: string;
  creditReduction: string;
  requiresAuthorization: boolean;
  reference: string;
}

export interface TicketView {
  sale: ReturnSale;
  returnable: { item: ReturnItem; available: string }[];
  voidable: boolean;
}

const dateIn = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);

const sumCents = (values: readonly Cents[]) => values.reduce((total, v) => total + v, 0n);

abstract class ReturnUseCase {
  constructor(protected readonly deps: ReturnDependencies) {}

  // Un rechazo que deja rastro (la alerta al AS) se confirma y recién después se informa.
  protected async inTenant<T>(
    context: SecurityContext,
    work: (actor: Actor) => Promise<T | Rejection>,
  ): Promise<T> {
    await this.deps.access.check(context, OPERATE);
    const tenantId = this.deps.access.requireTenant(context);
    const result = await this.deps.uow.run(
      () => work({ tenantId, userId: context.userId, at: this.deps.clock.now() }),
      { tenantId },
    );
    if (result instanceof Rejection) throw result.error;
    return result;
  }

  protected async shiftOf(actor: Actor) {
    const shift = await this.deps.shifts.openShiftOf(actor.tenantId, actor.userId);
    if (!shift) {
      throw new DomainError('SIN_TURNO', 'Abrí un turno en una caja para devolver o anular.');
    }
    return shift;
  }

  protected async sale(context: SecurityContext, actor: Actor, saleId: string) {
    const sale = await this.deps.returns.find(actor.tenantId, saleId, true);
    if (!sale) return this.deps.access.notFound(context, 'venta', saleId);
    return sale;
  }

  // RF-169: con el módulo inactivo no se devuelve ni se anula una venta facturada (D-60, D-89).
  protected async assertFiscal(tenantId: string, sale: ReturnSale) {
    if (sale.billed === true && !(await this.deps.settings.billingModule(tenantId))) {
      throw new DomainError(
        'MODULO_FISCAL_INACTIVO',
        'La venta se facturó y el módulo de facturación está inactivo: no se puede emitir su Nota de Crédito.',
      );
    }
  }

  protected async requestCreditNote(
    tenantId: string,
    sale: ReturnSale,
    originId: string,
    total: string,
  ) {
    if (sale.billed !== true) return;
    await this.deps.outbox.add({
      type: 'nota_credito.solicitada',
      tenantId,
      payload: { ventaId: sale.id, origenId: originId, total },
    });
  }

  protected async moveStock(
    actor: Actor,
    branchId: string,
    item: ReturnItem,
    quantity: string,
    operation: 'pasarARevision' | 'reponer',
    reference: string,
  ) {
    const targets =
      item.type === 'combo'
        ? item.components.map((c) => ({
            product: { id: c.productId, name: c.name },
            quantity: componentQuantity(c.quantity, quantity),
          }))
        : [{ product: { id: item.productId, name: item.name }, quantity }];
    for (const target of targets) {
      await this.deps.stock.apply(actor, {
        branchId,
        product: target.product,
        operation,
        quantity: target.quantity,
        reference,
      });
    }
  }

  // Reintegra por la pasarela las partes electrónicas. Devuelve las que confirmó.
  protected async refundElectronic(
    tenantId: string,
    parts: readonly RefundPart[],
    refundKey: (part: RefundPart) => string,
    whole: boolean,
  ) {
    const done: RefundPart[] = [];
    let failed = false;
    for (const part of parts) {
      const key = part.payment.key;
      const answer =
        key === null
          ? 'rechazado'
          : await askRefund(() =>
              whole
                ? this.deps.gateway.refund({ tenantId, key })
                : this.deps.gateway.refundPart({
                    tenantId,
                    key,
                    refundKey: refundKey(part),
                    amount: part.amount,
                  }),
            );
      if (answer === 'revertido') done.push(part);
      else {
        failed = true;
        break;
      }
    }
    return { done, failed };
  }

  protected refundRow(
    actor: Actor,
    part: RefundPart,
    origin: { returnId: string | null; voidId: string | null },
    extra: { amount?: string; excess?: string; key?: string | null } = {},
  ): RefundRecord {
    return {
      id: this.deps.ids.next(),
      returnId: origin.returnId,
      voidId: origin.voidId,
      paymentId: part.payment.id,
      type: part.payment.type,
      amount: extra.amount ?? part.amount,
      excess: extra.excess ?? '0.00',
      key: extra.key ?? null,
      at: actor.at,
    };
  }
}

// Ticket desde cualquier sucursal del comercio, con lo que todavía se puede devolver (RF-083).
export class FindTicket extends ReturnUseCase {
  async execute(context: SecurityContext, ticket: number): Promise<TicketView> {
    return this.inTenant(context, async (actor) => {
      // Un ticket de otro comercio responde como inexistente (RF-002), con turno o sin él.
      const sale = await this.deps.returns.findByTicket(actor.tenantId, ticket);
      if (!sale) throw notFoundError();
      const shift = await this.shiftOf(actor);
      return {
        sale,
        returnable: sale.items.map((item) => ({
          item,
          available: (Number(item.quantity) - Number(item.returned)).toFixed(3),
        })),
        voidable: sale.state === 'confirmada' && !sale.hasReturns && sale.shiftId === shift.id,
      };
    });
  }
}

export interface ReturnRequest {
  itemId: string;
  quantity: string;
}

abstract class ReturnPlanning extends ReturnUseCase {
  // Cálculo del reintegro (RF-085, RF-086): valor de lo devuelto y su parte de cada medio.
  protected async plan(actor: Actor, sale: ReturnSale, requested: readonly ReturnRequest[]) {
    if (requested.length === 0) {
      throw new DomainError('DEVOLUCION_VACIA', 'Elegí al menos un ítem para devolver.');
    }
    const items = requested.map((r) => {
      const item = sale.items.find((i) => i.id === r.itemId);
      if (!item) throw new DomainError('ITEM_INVALIDO', 'El ítem no pertenece a la venta.');
      const amount = returnedLineValue(cents(item.final), item.quantity, item.returned, r.quantity);
      return { item, quantity: Number(r.quantity).toFixed(3), amount };
    });
    const value = sumCents(items.map((i) => i.amount));
    if (value <= 0n) {
      throw new DomainError('DEVOLUCION_SIN_VALOR', 'Lo elegido no tiene importe para reintegrar.');
    }
    const fractions = sale.payments.map((p) => ({
      id: p.id,
      creditAccount: p.type === 'cuenta_corriente',
      charged: cents(p.charged),
    }));
    const split = refundByFraction(cents(sale.total), fractions, cents(sale.returnedValue), value);
    const parts: RefundPart[] = split.map((s) => {
      const payment = sale.payments.find((p) => p.id === s.id);
      if (!payment) throw new Error('El reintegro no corresponde a un pago de la venta.');
      return { payment, amount: money(s.refund) };
    });
    return { items, value, parts, ...(await this.cashOf(actor, sale, parts)) };
  }

  protected async cashOf(actor: Actor, sale: ReturnSale, parts: readonly RefundPart[]) {
    let cash = sumCents(
      parts.filter((p) => p.payment.type === 'efectivo').map((p) => cents(p.amount)),
    );
    let creditReduction = 0n;
    const credit = sumCents(
      parts.filter((p) => p.payment.type === 'cuenta_corriente').map((p) => cents(p.amount)),
    );
    if (credit > 0n && sale.customerId !== null) {
      const free = cents(await this.deps.credit.freeBalance(actor.tenantId, sale.customerId));
      const split = creditRefund(credit, free);
      creditReduction = split.balanceReduction;
      cash += split.cashExcess;
    } else if (credit > 0n) {
      cash += credit;
    }
    return { cash, creditReduction };
  }

  protected toPlan(
    sale: ReturnSale,
    planned: Awaited<ReturnType<ReturnPlanning['plan']>>,
  ): ReturnPlan {
    const refund = money(sumCents(planned.parts.map((p) => cents(p.amount))));
    return {
      items: planned.items.map((i) => ({ ...i, amount: money(i.amount) })),
      value: money(planned.value),
      refund,
      parts: planned.parts,
      cash: money(planned.cash),
      creditReduction: money(planned.creditReduction),
      // Reembolsar en efectivo exige el PIN de un AS (RF-081, RF-086).
      requiresAuthorization: planned.cash > 0n,
      reference: refundReference(sale.id, refund),
    };
  }

  protected async validate(context: SecurityContext, actor: Actor, saleId: string) {
    const sale = await this.sale(context, actor, saleId);
    const shift = await this.shiftOf(actor);
    if (sale.state !== 'confirmada') {
      throw new DomainError('VENTA_NO_DEVOLVIBLE', 'Solo se devuelve una venta confirmada.');
    }
    await this.assertFiscal(actor.tenantId, sale);
    const days = await this.deps.settings.returnWindowDays(actor.tenantId);
    const timeZone = await this.deps.settings.timeZone(actor.tenantId);
    assertReturnWindow(sale.journeyDate, days, dateIn(actor.at, timeZone));
    return { shift, sale };
  }
}

export class QuoteReturn extends ReturnPlanning {
  async execute(
    context: SecurityContext,
    saleId: string,
    requested: ReturnRequest[],
  ): Promise<ReturnPlan> {
    return this.inTenant(context, async (actor) => {
      const { sale } = await this.validate(context, actor, saleId);
      return this.toPlan(sale, await this.plan(actor, sale, requested));
    });
  }
}

export interface ReturnResult {
  id: string;
  plan: ReturnPlan;
}

// Confirmación de una devolución (RF-085 a RF-087, RF-137): reintegro proporcional desde la caja
// del turno actual e ítems "En Revisión" en la sucursal que los recibe.
export class ConfirmReturn extends ReturnPlanning {
  async execute(
    context: SecurityContext,
    saleId: string,
    input: { items: ReturnRequest[]; authorizationId: string | null },
  ): Promise<ReturnResult> {
    const started = await this.inTenant(context, async (actor) => {
      const { shift, sale } = await this.validate(context, actor, saleId);
      const plan = this.toPlan(sale, await this.plan(actor, sale, input.items));
      if (plan.requiresAuthorization) {
        if (input.authorizationId === null) {
          throw new DomainError(
            'REEMBOLSO_REQUIERE_AUTORIZACION',
            `El reintegro incluye ${plan.cash} en efectivo: pedí la autorización de un AS.`,
          );
        }
        await this.deps.authorizations.consume({
          id: input.authorizationId,
          type: 'reembolso',
          operationRef: plan.reference,
          requesterId: actor.userId,
        });
      }
      if (cents(plan.cash) > cents(await this.deps.shifts.cashOnHand(actor.tenantId, shift.id))) {
        await this.deps.shifts.refundRejected(actor, {
          shiftId: shift.id,
          amount: plan.cash,
          authorizationId: input.authorizationId,
        });
        return new Rejection(
          new DomainError(
            'REINTEGRO_RECHAZADO',
            'No se pudo pagar el reintegro. El AS que lo autorizó recibió el detalle.',
          ),
        );
      }
      // Las cantidades se reservan antes del reintegro: dos devoluciones del mismo ticket nunca
      // superan lo vendido (RF-084, RF-152).
      for (const line of plan.items) {
        if (!(await this.deps.sales.addReturned(actor.tenantId, line.item.id, line.quantity))) {
          throw new DomainError(
            'DEVOLUCION_EXCEDIDA',
            `No se puede devolver más de lo vendido de «${line.item.name}».`,
          );
        }
      }
      const id = this.deps.ids.next();
      await this.deps.returns.insertReturn(actor.tenantId, {
        id,
        saleId: sale.id,
        branchId: shift.branchId,
        shiftId: shift.id,
        sellerId: actor.userId,
        value: plan.value,
        refund: plan.refund,
        authorizationId: plan.requiresAuthorization ? input.authorizationId : null,
        at: actor.at,
        items: plan.items.map((l) => ({
          id: this.deps.ids.next(),
          saleItemId: l.item.id,
          productId: l.item.productId,
          quantity: l.quantity,
          amount: l.amount,
        })),
      });
      const electronic = plan.parts.filter(
        (p) => p.payment.type === 'electronico' && cents(p.amount) > 0n,
      );
      if (electronic.length === 0) {
        await this.apply(actor, { sale, shift, plan, id, authorizationId: input.authorizationId });
        return { done: { id, plan } };
      }
      return { pending: { id, plan, shift, sale, electronic } };
    });
    if ('done' in started) return started.done;

    const { id, plan, electronic } = started.pending;
    const tenantId = this.deps.access.requireTenant(context);
    const refunded = await this.refundElectronic(
      tenantId,
      electronic,
      (part) => `devolucion:${id}:${part.payment.id}`,
      false,
    );
    return this.inTenant(context, async (actor) => {
      const sale = await this.sale(context, actor, saleId);
      const { shift } = started.pending;
      if (refunded.failed) {
        await this.release(actor, id, plan);
        if (refunded.done.length > 0) {
          await this.deps.uncertain.add({
            tenantId,
            branchId: shift.branchId,
            saleId: sale.id,
            detail: { devolucionId: id, reintegrado: refunded.done.map((p) => p.amount) },
            at: actor.at,
          });
        }
        return new Rejection(
          new DomainError(
            'REINTEGRO_ELECTRONICO_FALLIDO',
            'La pasarela no confirmó el reintegro: la devolución no se registró. Probá de nuevo.',
          ),
        );
      }
      await this.apply(actor, {
        sale,
        shift,
        plan,
        id,
        authorizationId: input.authorizationId,
        keys: (part) => `devolucion:${id}:${part.payment.id}`,
      });
      return { id, plan };
    });
  }

  private async release(actor: Actor, id: string, plan: ReturnPlan) {
    for (const line of plan.items) {
      await this.deps.sales.subtractReturned(actor.tenantId, line.item.id, line.quantity);
    }
    await this.deps.returns.resolveReturn(actor.tenantId, id, 'rechazada', actor.at);
  }

  private async apply(
    actor: Actor,
    input: {
      sale: ReturnSale;
      shift: { id: string; branchId: string };
      plan: ReturnPlan;
      id: string;
      authorizationId: string | null;
      keys?: (part: RefundPart) => string;
    },
  ) {
    const { sale, shift, plan, id } = input;
    for (const line of plan.items) {
      await this.moveStock(actor, shift.branchId, line.item, line.quantity, 'pasarARevision', id);
    }
    const origin = { returnId: id, voidId: null };
    const authorizationId = plan.requiresAuthorization ? input.authorizationId : null;
    for (const part of plan.parts) {
      if (cents(part.amount) === 0n) continue;
      if (part.payment.type === 'cuenta_corriente') {
        const credit =
          sale.customerId === null
            ? { reduced: '0.00', excess: part.amount }
            : await this.deps.credit.refund(actor, {
                customerId: sale.customerId,
                amount: part.amount,
                saleId: sale.id,
                type: 'devolucion',
              });
        if (cents(credit.excess) > 0n) {
          await this.deps.shifts.recordReturn(actor, {
            shiftId: shift.id,
            amount: credit.excess,
            methodId: null,
            inCash: true,
            type: 'reintegro',
            authorizationId,
          });
        }
        await this.deps.returns.addRefund(
          actor.tenantId,
          this.refundRow(actor, part, origin, { amount: credit.reduced, excess: credit.excess }),
        );
        continue;
      }
      await this.deps.shifts.recordReturn(actor, {
        shiftId: shift.id,
        amount: part.amount,
        methodId: part.payment.methodId,
        inCash: part.payment.type === 'efectivo',
        type: 'reintegro',
        authorizationId,
      });
      await this.deps.returns.addRefund(
        actor.tenantId,
        this.refundRow(actor, part, origin, {
          key: part.payment.type === 'electronico' ? (input.keys?.(part) ?? null) : null,
        }),
      );
    }
    await this.deps.returns.resolveReturn(actor.tenantId, id, 'confirmada', actor.at);
    await this.requestCreditNote(actor.tenantId, sale, id, plan.refund);
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      branchId: shift.branchId,
      userId: actor.userId,
      activeRole: 'VO',
      action: 'devolucion_confirmada',
      entity: 'venta',
      entityId: sale.id,
      after: { devolucionId: id, valor: plan.value, reintegro: plan.refund, efectivo: plan.cash },
      ...(authorizationId ? { authorizationId } : {}),
    });
  }
}

// Anulación total dentro del turno, con PIN de un AS (RF-081, RF-082, RF-136, D-27). Una venta a
// crédito cuyo saldo ya bajó se anula igual: el excedente sale en efectivo (D-89).
export class VoidSale extends ReturnPlanning {
  async execute(
    context: SecurityContext,
    saleId: string,
    input: { authorizationId: string | null; items: ReturnRequest[] | null },
  ): Promise<{ id: string; refund: string }> {
    const started = await this.inTenant(context, async (actor) => {
      const shift = await this.deps.shifts.openShiftOf(actor.tenantId, actor.userId);
      const sale = await this.sale(context, actor, saleId);
      assertVoidable({
        state: sale.state,
        shiftOpen: shift !== undefined,
        sameShift: shift?.id === sale.shiftId,
        hasReturns: sale.hasReturns,
        partial: input.items !== null && !coversAll(sale, input.items),
      });
      if (!shift) throw new DomainError('SIN_TURNO', 'Abrí un turno para anular.');
      await this.assertFiscal(actor.tenantId, sale);
      if (input.authorizationId === null) {
        throw new DomainError(
          'ANULACION_REQUIERE_AUTORIZACION',
          'Anular una venta exige la autorización de un AS.',
        );
      }
      await this.deps.authorizations.consume({
        id: input.authorizationId,
        type: 'anulacion',
        operationRef: voidReference(sale.id),
        requesterId: actor.userId,
      });
      const parts: RefundPart[] = sale.payments.map((payment) => ({
        payment,
        amount: payment.charged,
      }));
      const { cash } = await this.cashOf(actor, sale, parts);
      if (cash > cents(await this.deps.shifts.cashOnHand(actor.tenantId, shift.id))) {
        await this.deps.shifts.refundRejected(actor, {
          shiftId: shift.id,
          amount: money(cash),
          authorizationId: input.authorizationId,
        });
        return new Rejection(
          new DomainError(
            'REINTEGRO_RECHAZADO',
            'No se pudo anular la venta. El AS que lo autorizó recibió el detalle.',
          ),
        );
      }
      const electronic = parts.filter((p) => p.payment.type === 'electronico');
      const id = this.deps.ids.next();
      if (electronic.length === 0) {
        await this.apply(actor, { sale, shift, parts, id, authorizationId: input.authorizationId });
        return { done: { id, refund: total(parts) } };
      }
      return { pending: { id, shift, parts, electronic } };
    });
    if ('done' in started) return started.done;

    const { id, shift, parts, electronic } = started.pending;
    const tenantId = this.deps.access.requireTenant(context);
    const refunded = await this.refundElectronic(tenantId, electronic, () => '', true);
    return this.inTenant(context, async (actor) => {
      const sale = await this.sale(context, actor, saleId);
      if (refunded.failed || sale.state !== 'confirmada') {
        if (refunded.done.length > 0) {
          await this.deps.uncertain.add({
            tenantId,
            branchId: shift.branchId,
            saleId: sale.id,
            detail: { anulacion: true, reintegrado: refunded.done.map((p) => p.amount) },
            at: actor.at,
          });
        }
        return new Rejection(
          new DomainError(
            'REINTEGRO_ELECTRONICO_FALLIDO',
            'La pasarela no confirmó el reintegro: la venta no se anuló. Probá de nuevo con otra autorización.',
          ),
        );
      }
      await this.apply(actor, { sale, shift, parts, id, authorizationId: input.authorizationId });
      return { id, refund: total(parts) };
    });
  }

  private async apply(
    actor: Actor,
    input: {
      sale: ReturnSale;
      shift: { id: string; branchId: string };
      parts: RefundPart[];
      id: string;
      authorizationId: string | null;
    },
  ) {
    const { sale, shift, parts, id, authorizationId } = input;
    for (const item of sale.items) {
      await this.moveStock(actor, sale.branchId, item, item.quantity, 'reponer', id);
    }
    await this.deps.returns.insertVoid(actor.tenantId, {
      id,
      saleId: sale.id,
      shiftId: shift.id,
      requesterId: actor.userId,
      authorizationId: authorizationId ?? '',
      refund: total(parts),
      at: actor.at,
    });
    const origin = { returnId: null, voidId: id };
    for (const part of parts) {
      if (cents(part.amount) === 0n) continue;
      if (part.payment.type === 'cuenta_corriente') {
        const credit =
          sale.customerId === null
            ? { reduced: '0.00', excess: part.amount }
            : await this.deps.credit.refund(actor, {
                customerId: sale.customerId,
                amount: part.amount,
                saleId: sale.id,
                type: 'anulacion',
              });
        if (cents(credit.excess) > 0n) {
          await this.deps.shifts.recordReturn(actor, {
            shiftId: shift.id,
            amount: credit.excess,
            methodId: null,
            inCash: true,
            type: 'anulacion',
            authorizationId,
          });
        }
        await this.deps.returns.addRefund(
          actor.tenantId,
          this.refundRow(actor, part, origin, { amount: credit.reduced, excess: credit.excess }),
        );
        continue;
      }
      await this.deps.shifts.recordReturn(actor, {
        shiftId: shift.id,
        amount: part.amount,
        methodId: part.payment.methodId,
        inCash: part.payment.type === 'efectivo',
        type: 'anulacion',
        authorizationId,
      });
      await this.deps.returns.addRefund(actor.tenantId, this.refundRow(actor, part, origin));
    }
    await this.deps.sales.markVoided(actor.tenantId, sale.id);
    await this.requestCreditNote(actor.tenantId, sale, id, total(parts));
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      branchId: sale.branchId,
      userId: actor.userId,
      activeRole: 'VO',
      action: 'venta_anulada',
      entity: 'venta',
      entityId: sale.id,
      after: { anulacionId: id, reintegro: total(parts) },
      ...(authorizationId ? { authorizationId } : {}),
    });
  }
}

const total = (parts: readonly RefundPart[]) => money(sumCents(parts.map((p) => cents(p.amount))));

// Una anulación con ítems indicados solo es válida si los cubre todos (RF-136).
function coversAll(sale: ReturnSale, items: readonly ReturnRequest[]): boolean {
  return sale.items.every((item) =>
    items.some((r) => r.itemId === item.id && Number(r.quantity) === Number(item.quantity)),
  );
}
