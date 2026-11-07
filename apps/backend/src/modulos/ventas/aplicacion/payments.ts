// Cobro de una venta (T-169 a T-171, T-175 a T-179; RF-068 a RF-076, RF-125 a RF-127, RF-144,
// D-85). Los pagos electrónicos se hacen de a uno contra la pasarela, fuera de toda transacción:
// primero se registra el intento, después se consulta y al final se guarda el resultado. Los
// medios restantes se imputan al confirmar, en una sola transacción.
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import { adjustFractions, cents, money, planPayment } from '../../calculo/aplicacion/engine.js';
import {
  askGateway,
  askRefund,
  assertGatewayConfigured,
  creditReference,
  MANUAL_AFTER_CHECKS,
  nextVerification,
  paymentReference,
  type PaymentMethod,
} from '../../cobros/aplicacion/gateway.js';
import { requiresInvoiceA } from '../../fiscal/aplicacion/fiscal.js';
import { billingDecision, idleUntil } from '../dominio/sales.js';
import type { Actor, Payment, Sale } from './ports.js';
import { type CartView, LIVE_STATES, type Receipt, SalesUseCase } from './sales.js';

export const PAYMENT_VERIFICATION_JOB = 'ventas.verificar_pago';

const chargedOf = (p: Pick<Payment, 'fraction' | 'adjustment'>) =>
  cents(p.fraction) + cents(p.adjustment);

// Lo que todavía falta asignar a un medio de pago.
export function unpaidBalance(total: string, payments: readonly Payment[]): string {
  const taken = payments
    .filter((p) => LIVE_STATES.has(p.state))
    .reduce((sum, p) => sum + cents(p.fraction), 0n);
  return money(cents(total) - taken);
}

abstract class SalePaymentUseCase extends SalesUseCase {
  // Guarda el resultado de un pago electrónico sin resolver y actualiza el estado de la venta.
  protected async settle(
    actor: Actor,
    sale: Sale,
    payment: Payment,
    outcome: 'aprobado' | 'rechazado' | 'por_verificar',
    reference: string | null,
    extra: Partial<Payment> = {},
  ): Promise<Sale> {
    if (payment.state !== 'pendiente' && payment.state !== 'por_verificar') return sale;
    await this.deps.sales.savePayment(actor.tenantId, {
      ...payment,
      ...extra,
      state: outcome,
      reference: reference ?? payment.reference,
    });
    return this.refreshState(actor, sale);
  }

  // La venta queda "pago por verificar" mientras algún pago no tenga resultado (RF-126). Si ya no
  // retiene pagos, vuelve a vencer por inactividad.
  protected async refreshState(actor: Actor, sale: Sale): Promise<Sale> {
    const payments = await this.deps.sales.paymentsOf(actor.tenantId, sale.id);
    const next: Sale = {
      ...sale,
      state: payments.some((p) => p.state === 'por_verificar') ? 'pago_por_verificar' : 'en_curso',
      lastActivity: actor.at,
    };
    await this.deps.sales.save(next);
    if (!payments.some((p) => LIVE_STATES.has(p.state))) {
      const idle = await this.deps.settings.cartIdleMinutes(actor.tenantId);
      await this.scheduleExpiration(next, idleUntil(actor.at, idle));
    }
    return next;
  }

  protected async scheduleCheck(tenantId: string, paymentId: string, runAt: Date) {
    await this.deps.jobs.schedule({
      type: PAYMENT_VERIFICATION_JOB,
      key: `${paymentId}:${runAt.toISOString()}`,
      runAt,
      payload: { tenantId, paymentId },
    });
  }

  protected audit(actor: Actor, sale: Sale, action: string, after: Record<string, unknown>) {
    return this.deps.audit.record({
      tenantId: actor.tenantId,
      branchId: sale.branchId,
      userId: actor.userId,
      activeRole: 'VO',
      action,
      entity: 'venta',
      entityId: sale.id,
      after,
    });
  }

  protected async ownPayment(
    context: SecurityContext,
    actor: Actor,
    sale: Sale,
    id: string,
  ): Promise<Payment> {
    const payment = await this.deps.sales.findPayment(actor.tenantId, id);
    if (payment?.saleId !== sale.id) return this.deps.access.notFound(context, 'venta', sale.id);
    return payment;
  }
}

export interface PaymentAttempt {
  cart: CartView;
  payment: Payment;
}

// Un pago electrónico (RF-068, RF-075, RF-126). Repetir la clave devuelve el mismo intento.
export class ChargeElectronic extends SalePaymentUseCase {
  async execute(
    context: SecurityContext,
    saleId: string,
    input: { methodId: string; fraction: string; key: string },
  ): Promise<PaymentAttempt> {
    const started = await this.inTenant(context, async (actor) => {
      const repeated = await this.deps.sales.paymentByKey(actor.tenantId, input.key);
      if (repeated) {
        const sale = await this.ownSale(context, actor, repeated.saleId);
        return { done: { cart: await this.view(actor, sale), payment: repeated } };
      }
      const sale = await this.ownSale(context, actor, saleId);
      if (sale.state !== 'en_curso' && sale.state !== 'pago_por_verificar') {
        throw new DomainError('VENTA_NO_EDITABLE', 'La venta ya no está en curso.');
      }
      if (await this.deps.sales.pendingTransfer(actor.tenantId, sale.id)) {
        throw new DomainError('TRASPASO_PENDIENTE', 'La venta tiene un traspaso pendiente.');
      }
      assertGatewayConfigured(this.deps.gateway);
      const method = (await this.deps.settings.methods(actor.tenantId)).find(
        (m) => m.id === input.methodId,
      );
      if (method?.type !== 'electronico') {
        throw new DomainError('METODO_INVALIDO', 'Elegí un medio de pago electrónico.');
      }
      const payments = await this.deps.sales.paymentsOf(actor.tenantId, sale.id);
      // Mientras no se conozca el resultado, ese medio no se reintenta (RF-126).
      if (
        payments.some(
          (p) =>
            p.methodId === method.id && (p.state === 'por_verificar' || p.state === 'pendiente'),
        )
      ) {
        throw new DomainError(
          'PAGO_POR_VERIFICAR',
          `Hay un pago con ${method.name} sin resultado: no se puede reintentar con ese medio.`,
        );
      }
      const live = payments.some((p) => LIVE_STATES.has(p.state));
      const current = live ? await this.view(actor, sale) : await this.reprice(actor, sale);
      if (current.priced.items.length === 0) {
        throw new DomainError('VENTA_VACIA', 'Agregá al menos un producto antes de cobrar.');
      }
      const fraction = adjustFractions(cents(input.fraction, 'La fracción'), [
        {
          id: method.id,
          cash: false,
          adjustmentPct: method.adjustmentPct,
          amount: input.fraction,
        },
      ])[0];
      if (!fraction) throw new Error('El pago no tiene fracción.');
      const unpaid = cents(unpaidBalance(current.priced.total, payments));
      if (fraction.amount > unpaid) {
        throw new DomainError(
          'FRACCIONES_NO_CUADRAN',
          `La fracción supera lo que falta cobrar: $ ${money(unpaid)}.`,
        );
      }
      const payment: Payment = {
        id: this.deps.ids.next(),
        saleId: sale.id,
        methodId: method.id,
        methodName: method.name,
        type: 'electronico',
        fraction: money(fraction.amount),
        adjustment: money(fraction.adjustment),
        tendered: money(fraction.charged),
        change: '0.00',
        state: 'pendiente',
        key: input.key,
        reference: null,
        checks: 0,
        manuallyResolved: false,
        lateApprovedAt: null,
        authorizationId: null,
        at: actor.at,
      };
      await this.deps.sales.addPayment(actor.tenantId, payment);
      // Si el proceso cae antes del resultado, el worker lo averigua igual.
      const runAt = nextVerification(actor.at, 0, actor.at);
      if (runAt) await this.scheduleCheck(actor.tenantId, payment.id, runAt);
      return { payment };
    });
    if ('done' in started) return started.done;

    const { payment } = started;
    const tenantId = this.deps.access.requireTenant(context);
    const answer = await askGateway(() =>
      this.deps.gateway.charge({
        tenantId,
        key: input.key,
        amount: money(chargedOf(payment)),
        description: `Venta ${saleId.slice(0, 8)}`,
      }),
    );
    return this.inTenant(context, async (actor) => {
      const sale = await this.ownSale(context, actor, saleId);
      const latest = await this.deps.sales.findPayment(actor.tenantId, payment.id);
      if (!latest) throw new Error('El pago desapareció.');
      const outcome = answer.outcome === 'sin_respuesta' ? 'por_verificar' : answer.outcome;
      const next = await this.settle(actor, sale, latest, outcome, answer.reference);
      await this.audit(actor, sale, 'pago_electronico', {
        metodo: payment.methodName,
        monto: money(chargedOf(payment)),
        resultado: outcome,
      });
      const result = await this.deps.sales.findPayment(actor.tenantId, payment.id);
      return { cart: await this.view(actor, next), payment: result ?? latest };
    });
  }
}

// Reversión de un pago aprobado por el propio VO, sin PIN (RF-125, D-85). El dinero vuelve por la
// pasarela. Mientras dura, el pago queda "revirtiendo": la venta no se puede confirmar.
export class ReversePayment extends SalePaymentUseCase {
  async execute(context: SecurityContext, saleId: string, paymentId: string): Promise<CartView> {
    const payment = await this.inTenant(context, async (actor) => {
      const sale = await this.ownSale(context, actor, saleId);
      const found = await this.ownPayment(context, actor, sale, paymentId);
      if (sale.state === 'confirmada' || sale.state === 'anulada') {
        throw new DomainError('VENTA_NO_EDITABLE', 'La venta ya está confirmada.');
      }
      if (
        found.type !== 'electronico' ||
        (found.state !== 'aprobado' && found.state !== 'revirtiendo')
      ) {
        throw new DomainError(
          'PAGO_NO_REVERSIBLE',
          'Solo se revierte un pago electrónico aprobado.',
        );
      }
      const reversing: Payment = { ...found, state: 'revirtiendo' };
      await this.deps.sales.savePayment(actor.tenantId, reversing);
      return reversing;
    });

    const tenantId = this.deps.access.requireTenant(context);
    const key = payment.key;
    const answer =
      key === null
        ? 'rechazado'
        : await askRefund(() => this.deps.gateway.refund({ tenantId, key }));
    const result = await this.inTenant(context, async (actor) => {
      const sale = await this.ownSale(context, actor, saleId);
      const done = answer === 'revertido';
      await this.deps.sales.savePayment(actor.tenantId, {
        ...payment,
        state: done ? 'revertido' : 'aprobado',
      });
      const next = await this.refreshState(actor, sale);
      if (done) {
        await this.audit(actor, sale, 'pago_revertido', {
          metodo: payment.methodName,
          monto: money(chargedOf(payment)),
        });
      }
      return { done, cart: await this.view(actor, next) };
    });
    if (!result.done) {
      throw new DomainError(
        'REVERSION_FALLIDA',
        'La pasarela no confirmó la reversión: el pago sigue aprobado. Intentá de nuevo.',
      );
    }
    return result.cart;
  }
}

// Resolución manual de un pago por verificar, con el PIN de un AS de la sucursal (RF-126).
export class ResolvePayment extends SalePaymentUseCase {
  async execute(
    context: SecurityContext,
    saleId: string,
    paymentId: string,
    input: { result: 'aprobado' | 'rechazado'; authorizationId: string },
  ): Promise<CartView> {
    return this.inTenant(context, async (actor) => {
      const sale = await this.ownSale(context, actor, saleId);
      const payment = await this.ownPayment(context, actor, sale, paymentId);
      if (payment.state !== 'por_verificar') {
        throw new ApplicationError('conflict', 'PAGO_RESUELTO', 'El pago ya tiene un resultado.');
      }
      if (payment.checks < MANUAL_AFTER_CHECKS) {
        throw new DomainError(
          'VERIFICACION_EN_CURSO',
          'Todavía se está consultando a la pasarela: esperá unos minutos.',
        );
      }
      await this.deps.authorizations.consume({
        id: input.authorizationId,
        type: 'pago_por_verificar',
        operationRef: paymentReference(payment.id),
        requesterId: actor.userId,
      });
      const next = await this.settle(actor, sale, payment, input.result, null, {
        manuallyResolved: true,
        authorizationId: input.authorizationId,
      });
      await this.deps.audit.record({
        tenantId: actor.tenantId,
        branchId: sale.branchId,
        userId: actor.userId,
        activeRole: 'VO',
        action: 'pago_resuelto_a_mano',
        entity: 'venta',
        entityId: sale.id,
        after: { pago: payment.id, resultado: input.result },
        authorizationId: input.authorizationId,
      });
      return this.view(actor, next);
    });
  }
}

const isOpen = (p: Payment) =>
  p.state === 'pendiente' ||
  p.state === 'por_verificar' ||
  (p.state === 'rechazado' && p.manuallyResolved && p.lateApprovedAt === null);

// Worker de verificación (AD-14): consulta a la pasarela los pagos sin resultado y sigue vigilando
// los rechazados a mano, para detectar una aprobación tardía (RF-127).
export class PaymentVerification extends SalePaymentUseCase {
  async verify(tenantId: string, paymentId: string): Promise<void> {
    const payment = await this.deps.uow.run(
      () => this.deps.sales.findPayment(tenantId, paymentId),
      { tenantId },
    );
    if (!payment?.key || !isOpen(payment)) return;
    const key = payment.key;
    const answer = await askGateway(() => this.deps.gateway.check({ tenantId, key }));
    await this.deps.uow.run(
      async () => {
        const sale = await this.deps.sales.find(tenantId, payment.saleId, true);
        const current = await this.deps.sales.findPayment(tenantId, paymentId);
        if (!sale || !current || !isOpen(current)) return;
        const now = this.deps.clock.now();
        const actor: Actor = { tenantId, userId: sale.sellerId, at: now };
        const checks = current.checks + 1;
        if (current.state === 'rechazado') {
          if (answer.outcome === 'aprobado') {
            await this.deps.sales.savePayment(tenantId, {
              ...current,
              checks,
              lateApprovedAt: now,
            });
            await this.deps.alerts.add({
              tenantId,
              branchId: sale.branchId,
              paymentId: current.id,
              detail: {
                monto: money(chargedOf(current)),
                metodo: current.methodName,
                ventaId: sale.id,
              },
              at: now,
            });
            return;
          }
          await this.deps.sales.savePayment(tenantId, { ...current, checks });
        } else if (answer.outcome === 'sin_respuesta') {
          await this.settle(actor, sale, current, 'por_verificar', null, { checks });
        } else {
          await this.settle(actor, sale, current, answer.outcome, answer.reference, { checks });
          return;
        }
        const runAt = nextVerification(current.at, checks, now);
        if (runAt) await this.scheduleCheck(tenantId, current.id, runAt);
      },
      { tenantId },
    );
  }
}

export interface PaymentLine {
  methodId: string;
  fraction: string;
  tendered: string | null;
}

// Confirmación (RF-076, T-158, T-169), en una sola transacción: consume las reservas, numera la
// venta, registra los pagos, el impacto en caja y en la cuenta corriente, consume la cuota, escribe
// la auditoría y, si se factura, deja el pedido del comprobante en el outbox.
export class ConfirmSale extends SalePaymentUseCase {
  async execute(
    context: SecurityContext,
    saleId: string,
    input: {
      // Sin líneas, lo que falta se paga en efectivo.
      lines: PaymentLine[] | null;
      tendered: string | null;
      invoice: boolean | null;
      authorizationId: string | null;
    },
  ): Promise<Receipt> {
    return this.inTenant(context, async (actor) => {
      const sale = await this.openSale(context, actor, saleId);
      const shift = await this.deps.shifts.openShiftOf(actor.tenantId, actor.userId);
      if (shift?.id !== sale.shiftId) {
        throw new DomainError('SIN_TURNO', 'La venta no pertenece a tu turno abierto.');
      }
      const previous = await this.deps.sales.paymentsOf(actor.tenantId, sale.id);
      if (previous.some((p) => LIVE_STATES.has(p.state) && p.state !== 'aprobado')) {
        throw new DomainError(
          'PAGO_POR_VERIFICAR',
          'La venta tiene un pago sin resultado: esperá a conocerlo.',
        );
      }
      const approved = previous.filter((p) => p.state === 'aprobado');
      const view =
        approved.length > 0 ? await this.view(actor, sale) : await this.reprice(actor, sale);
      const priced = view.priced;
      if (priced.items.length === 0) {
        throw new DomainError('VENTA_VACIA', 'Agregá al menos un producto antes de cobrar.');
      }
      await this.consumeQuota(actor, view, shift.journeyDate);

      const methods = await this.deps.settings.methods(actor.tenantId);
      const remaining = cents(unpaidBalance(priced.total, approved));
      const lines = this.linesFor(input, remaining, methods);
      const plan = planFor(remaining, lines, methods);

      for (const item of priced.items) {
        await this.moveStock(actor, view.sale, item, 'consumir', item.quantity);
      }
      const ticket = await this.deps.sales.nextTicket(actor.tenantId);
      const billing = await this.deps.settings.billing(actor.tenantId);
      const billed = billingDecision(
        billing.module,
        billing.policy,
        input.invoice,
        requiresInvoiceA(billing.issuer, view.customer?.fiscalCondition ?? null),
      );

      const created: Payment[] = plan.map(({ method, fraction }) => ({
        id: this.deps.ids.next(),
        saleId: sale.id,
        methodId: method?.id ?? null,
        methodName: method?.name ?? 'Efectivo',
        type: method?.type ?? 'efectivo',
        fraction: money(fraction.amount),
        adjustment: money(fraction.adjustment),
        tendered: money(fraction.tendered),
        change: money(fraction.change),
        state: 'aprobado',
        key: null,
        reference: null,
        checks: 0,
        manuallyResolved: false,
        lateApprovedAt: null,
        authorizationId: null,
        at: actor.at,
      }));
      let creditAuthorization: string | null = null;
      for (const payment of created) {
        await this.deps.sales.addPayment(actor.tenantId, payment);
        const amount = money(chargedOf(payment));
        if (payment.type === 'cuenta_corriente') {
          creditAuthorization = await this.chargeCredit(actor, view, amount, input.authorizationId);
        } else if (cents(amount) > 0n) {
          await this.deps.cash.recordSale(actor, {
            shiftId: sale.shiftId,
            amount,
            methodId: payment.methodId,
            inCash: true,
          });
        }
      }
      // Los pagos electrónicos entran al turno sin sumar al efectivo teórico.
      for (const payment of approved) {
        await this.deps.cash.recordSale(actor, {
          shiftId: sale.shiftId,
          amount: money(chargedOf(payment)),
          methodId: payment.methodId,
          inCash: false,
        });
      }

      const all = [...approved, ...created];
      const onCredit = all.some((p) => p.type === 'cuenta_corriente');
      const confirmed: Sale = {
        ...view.sale,
        ticket,
        state: 'confirmada',
        paymentState: onCredit ? 'saldo_cuenta_corriente' : 'pagada',
        fiscalState: billed ? 'pendiente' : 'no_se_factura',
        billed,
        confirmedAt: actor.at,
        creditAuthorizationId: creditAuthorization,
      };
      await this.deps.sales.save(confirmed);
      if (billed) {
        await this.deps.outbox.add({
          type: 'comprobante.solicitado',
          tenantId: actor.tenantId,
          payload: { ventaId: sale.id },
        });
      }
      const charged = money(all.reduce((total, p) => total + chargedOf(p), 0n));
      await this.audit(actor, sale, 'venta_confirmada', {
        ticket,
        total: priced.total,
        cobrado: charged,
        descuentoManual: priced.manualDiscount,
        seFactura: billed,
      });
      return {
        sale: confirmed,
        priced,
        payments: all,
        customer: view.customer,
        charged,
        adjustment: money(all.reduce((total, p) => total + cents(p.adjustment), 0n)),
        tendered: money(
          created
            .filter((p) => p.type === 'efectivo')
            .reduce((total, p) => total + cents(p.tendered), 0n),
        ),
        change: money(created.reduce((total, p) => total + cents(p.change), 0n)),
      };
    });
  }

  private linesFor(
    input: { lines: PaymentLine[] | null; tendered: string | null },
    remaining: bigint,
    methods: readonly PaymentMethod[],
  ): PaymentLine[] {
    if (input.lines !== null) return input.lines;
    if (remaining === 0n) return [];
    const cash = methods.find((m) => m.type === 'efectivo');
    return [{ methodId: cash?.id ?? '', fraction: money(remaining), tendered: input.tendered }];
  }

  // Cuota (D-83): lo autorizado por PIN no la consume y queda en la auditoría (D-34).
  private async consumeQuota(actor: Actor, view: CartView, journeyDate: string) {
    const { sale, priced } = view;
    if (cents(priced.manualDiscount) === 0n || sale.discount === null) return;
    if (sale.discountAuthorizationId === null) {
      await this.deps.quota.consume(actor, {
        branchId: sale.branchId,
        journeyDate,
        discount: {
          subtotal: priced.subtotal,
          amount: priced.manualDiscount,
          enteredPercent: sale.discount.type === 'porcentaje' ? sale.discount.value : null,
        },
      });
      return;
    }
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      branchId: sale.branchId,
      userId: actor.userId,
      activeRole: 'VO',
      action: 'descuento_fuera_de_cuota',
      entity: 'venta',
      entityId: sale.id,
      after: { monto: priced.manualDiscount, porcentaje: priced.manualPercent },
      authorizationId: sale.discountAuthorizationId,
    });
  }

  // Crédito (RF-073, RF-074, RF-144): dentro del límite suma al saldo; si lo excede, informa el
  // disponible y exige el PIN de un AS. Devuelve la autorización usada, si hubo exceso.
  private async chargeCredit(
    actor: Actor,
    view: CartView,
    amount: string,
    authorizationId: string | null,
  ): Promise<string | null> {
    const { sale, priced } = view;
    if (sale.customerId === null) {
      throw new DomainError('CLIENTE_REQUERIDO', 'Elegí un cliente para vender a crédito.');
    }
    const input = { customerId: sale.customerId, amount, saleId: sale.id };
    const within = await this.deps.customers.charge(actor, { ...input, allowExcess: false });
    if (within.ok) return null;
    if (authorizationId === null) {
      throw new DomainError(
        'CREDITO_EXCEDIDO',
        `La venta supera el crédito disponible del cliente: $ ${within.available}. Pedí la autorización de un AS.`,
      );
    }
    await this.deps.authorizations.consume({
      id: authorizationId,
      type: 'credito',
      operationRef: creditReference(sale.id, priced.total),
      requesterId: actor.userId,
    });
    await this.deps.customers.charge(actor, { ...input, allowExcess: true });
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      branchId: sale.branchId,
      userId: actor.userId,
      activeRole: 'VO',
      action: 'exceso_de_credito',
      entity: 'venta',
      entityId: sale.id,
      after: { monto: amount, disponible: within.available, clienteId: sale.customerId },
      authorizationId,
    });
    return authorizationId;
  }
}

// Plan de cobro de lo que falta. Si ya está todo pagado (o la venta no tiene importe), no hay más
// fracciones.
function planFor(remaining: bigint, lines: PaymentLine[], methods: readonly PaymentMethod[]) {
  const resolved = lines.map((line) => {
    const method = methods.find((m) => m.id === line.methodId);
    if (!method && line.methodId !== '') {
      throw new DomainError('METODO_INVALIDO', 'Elegí un medio de pago activo.');
    }
    if (method?.type === 'electronico') {
      throw new DomainError(
        'METODO_INVALIDO',
        'Un medio electrónico se cobra con la terminal antes de confirmar.',
      );
    }
    return { line, method };
  });
  if (remaining === 0n && resolved.length === 0) return [];
  const plan = planPayment(
    remaining,
    resolved.map(({ line, method }, index) => ({
      id: String(index),
      cash: method?.type !== 'cuenta_corriente',
      adjustmentPct: method?.adjustmentPct ?? '0',
      amount: line.fraction,
      tendered: method?.type === 'cuenta_corriente' ? null : line.tendered,
    })),
  );
  return plan.fractions.map((fraction, index) => ({
    method: resolved[index]?.method,
    fraction,
  }));
}

// Cliente de la venta: identifica al comprador y habilita la cuenta corriente (RF-073).
export class SetSaleCustomer extends SalePaymentUseCase {
  async execute(
    context: SecurityContext,
    saleId: string,
    customerId: string | null,
  ): Promise<CartView> {
    return this.inTenant(context, async (actor) => {
      const sale = await this.openSale(context, actor, saleId);
      if (customerId !== null) {
        const customer = await this.deps.customers.find(actor.tenantId, customerId);
        if (!customer?.isActive) {
          throw new DomainError('CLIENTE_INVALIDO', 'El cliente no existe o está dado de baja.');
        }
      }
      const next: Sale = { ...sale, customerId, lastActivity: actor.at };
      await this.deps.sales.save(next);
      return this.view(actor, next);
    });
  }
}

export interface BillingOption {
  // Sin el módulo no se muestra nada fiscal (RF-165).
  visible: boolean;
  proposal: boolean;
  required: boolean;
}

// Qué proponer al cobrar según la política y el comprador (RF-167).
export class GetBillingOption extends SalePaymentUseCase {
  async execute(context: SecurityContext, saleId: string): Promise<BillingOption> {
    return this.inTenant(context, async (actor) => {
      const view = await this.view(actor, await this.ownSale(context, actor, saleId));
      const billing = await this.deps.settings.billing(actor.tenantId);
      const forced = requiresInvoiceA(billing.issuer, view.customer?.fiscalCondition ?? null);
      return {
        visible: billing.module,
        proposal: billingDecision(billing.module, billing.policy, null, forced),
        required: billing.module && (billing.policy === 'siempre' || forced),
      };
    });
  }
}

export class SearchCustomers extends SalePaymentUseCase {
  async execute(context: SecurityContext, query: string) {
    return this.inTenant(context, async (actor) => {
      const text = query.trim();
      return text.length === 0 ? [] : this.deps.customers.search(actor.tenantId, text.slice(0, 60));
    });
  }
}

export class ListPaymentMethods extends SalePaymentUseCase {
  async execute(context: SecurityContext): Promise<PaymentMethod[]> {
    return this.inTenant(context, (actor) => this.deps.settings.methods(actor.tenantId));
  }
}
