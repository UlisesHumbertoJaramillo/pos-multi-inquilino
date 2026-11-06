// Cobros de cuenta corriente (T-172; RF-128, RF-129, D-23). El recargo del medio se cobra aparte:
// la deuda baja solo por lo imputado. Con un medio electrónico sin respuesta, el cobro queda por
// verificar y el saldo y el recibo esperan el resultado (D-85).
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import { ApplicationError, forbiddenError } from '../../../compartido/aplicacion/errors.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { JobScheduler } from '../../../compartido/aplicacion/job-scheduler.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import { cents, money, planPayment } from '../../calculo/aplicacion/engine.js';
import { normalizeCollection, paymentReference } from '../dominio/customers.js';
import {
  askGateway,
  assertGatewayConfigured,
  MANUAL_AFTER_CHECKS,
  nextVerification,
  type PaymentGateway,
  type RefundAlerts,
} from './gateway.js';
import type {
  Actor,
  Collection,
  CollectionAuthorizations,
  CollectionMethods,
  CollectionPayment,
  CollectionRepository,
  CollectionShifts,
  Customer,
  CustomerRepository,
  ReceiptRecord,
} from './ports.js';

export const COLLECTION_VERIFICATION_JOB = 'cobros.verificar_pago';

const OPERATE = 'devoluciones.iniciar' as const;

export interface CollectionDependencies {
  uow: UnitOfWork;
  customers: CustomerRepository;
  collections: CollectionRepository;
  methods: CollectionMethods;
  shifts: CollectionShifts;
  gateway: PaymentGateway;
  alerts: RefundAlerts;
  authorizations: CollectionAuthorizations;
  jobs: JobScheduler;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
  ids: IdGenerator;
}

export interface CollectionView {
  collection: Collection;
  payment: CollectionPayment;
  receipt: ReceiptRecord | null;
  balance: string;
  manualResolution: boolean;
}

abstract class CollectionUseCase {
  constructor(protected readonly deps: CollectionDependencies) {}

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

  protected async view(tenantId: string, collection: Collection): Promise<CollectionView> {
    const payment = await this.deps.collections.paymentOf(tenantId, collection.id);
    if (!payment) throw new Error('El cobro no tiene pago.');
    const customer = await this.deps.customers.find(tenantId, collection.customerId, false);
    return {
      collection,
      payment,
      receipt: (await this.deps.collections.receiptOf(tenantId, collection.id)) ?? null,
      balance: customer?.balance ?? '0.00',
      manualResolution: payment.state === 'por_verificar' && payment.checks >= MANUAL_AFTER_CHECKS,
    };
  }

  // Imputa el cobro: baja la deuda, deja el movimiento y el ingreso a la caja y emite el recibo.
  protected async apply(
    actor: Actor,
    collection: Collection,
    payment: CollectionPayment,
    charged: string,
  ) {
    const balance = await this.deps.customers.reduceBalance(
      actor.tenantId,
      collection.customerId,
      collection.amount,
    );
    if (balance === null) {
      throw new DomainError('COBRO_EXCEDE_DEUDA', 'El cobro supera lo que adeuda el cliente.');
    }
    await this.deps.customers.addMovement(actor, {
      id: this.deps.ids.next(),
      customerId: collection.customerId,
      type: 'cobro',
      amount: collection.amount,
      balance,
      saleId: null,
      collectionId: collection.id,
    });
    await this.deps.shifts.recordCollection(actor, {
      shiftId: collection.shiftId,
      amount: charged,
      methodId: payment.methodId,
      inCash: payment.type === 'efectivo',
    });
    await this.deps.collections.setState(actor.tenantId, collection.id, 'aplicado', actor.at);
    const receipt = await this.deps.collections.addReceipt(actor.tenantId, {
      id: this.deps.ids.next(),
      collectionId: collection.id,
      customerId: collection.customerId,
      shiftId: collection.shiftId,
      amount: collection.amount,
      issuedAt: actor.at,
    });
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      branchId: collection.branchId,
      userId: actor.userId,
      activeRole: 'VO',
      action: 'cobro_cuenta_corriente',
      entity: 'cliente',
      entityId: collection.customerId,
      after: { monto: collection.amount, cobrado: charged, recibo: receipt.number, saldo: balance },
    });
  }

  // Aplica el resultado de la pasarela a un cobro electrónico sin resolver.
  protected async settle(
    actor: Actor,
    collection: Collection,
    payment: CollectionPayment,
    outcome: 'aprobado' | 'rechazado' | 'por_verificar',
    reference: string | null,
    extra: Partial<CollectionPayment> = {},
  ): Promise<void> {
    if (payment.state !== 'pendiente' && payment.state !== 'por_verificar') return;
    await this.deps.collections.savePayment(actor.tenantId, {
      ...payment,
      ...extra,
      state: outcome,
      reference: reference ?? payment.reference,
    });
    if (outcome === 'por_verificar') {
      await this.deps.collections.setState(actor.tenantId, collection.id, outcome, actor.at);
      return;
    }
    await this.deps.customers.release(actor.tenantId, collection.customerId, collection.amount);
    if (outcome === 'rechazado') {
      await this.deps.collections.setState(actor.tenantId, collection.id, 'rechazado', actor.at);
      return;
    }
    await this.apply(actor, collection, payment, charged(payment));
  }
}

const charged = (p: CollectionPayment) => money(cents(p.amount) + cents(p.adjustment));

export class CollectAccount extends CollectionUseCase {
  async execute(
    context: SecurityContext,
    customerId: string,
    input: { methodId: string; amount: string; tendered: string | null; key: string },
  ): Promise<CollectionView> {
    const amount = normalizeCollection(input.amount);
    const started = await this.inTenant(context, async (actor) => {
      const repeated = await this.deps.collections.paymentByKey(actor.tenantId, input.key);
      if (repeated) {
        const previous = await this.deps.collections.find(
          actor.tenantId,
          repeated.collectionId,
          false,
        );
        if (previous?.sellerId !== actor.userId) throw forbiddenError();
        return { view: await this.view(actor.tenantId, previous) };
      }
      const customer = await this.deps.customers.find(actor.tenantId, customerId, true);
      if (!customer) return this.deps.access.notFound(context, 'cliente', customerId);
      const shift = await this.deps.shifts.openShiftOf(actor.tenantId, actor.userId);
      if (!shift) {
        throw new DomainError('SIN_TURNO', 'Abrí un turno en una caja para registrar el cobro.');
      }
      const method = (await this.deps.methods.active(actor.tenantId)).find(
        (m) => m.id === input.methodId,
      );
      if (method?.type !== 'efectivo' && method?.type !== 'electronico') {
        throw new DomainError('METODO_INVALIDO', 'Elegí un medio de pago válido para el cobro.');
      }
      assertWithinDebt(customer, amount);
      const cash = method.type === 'efectivo';
      if (!cash) assertGatewayConfigured(this.deps.gateway);
      const fraction = planPayment(cents(amount), [
        {
          id: method.id,
          cash,
          adjustmentPct: method.adjustmentPct,
          amount,
          tendered: cash ? input.tendered : null,
        },
      ]).fractions[0];
      if (!fraction) throw new Error('El cobro no tiene fracción.');
      const collection: Collection = {
        id: this.deps.ids.next(),
        tenantId: actor.tenantId,
        customerId: customer.id,
        customerName: customer.name,
        branchId: shift.branchId,
        shiftId: shift.id,
        sellerId: actor.userId,
        amount,
        state: cash ? 'aplicado' : 'pendiente',
        createdAt: actor.at,
      };
      const payment: CollectionPayment = {
        id: this.deps.ids.next(),
        collectionId: collection.id,
        methodId: method.id,
        methodName: method.name,
        type: method.type,
        amount,
        adjustment: money(fraction.adjustment),
        tendered: money(fraction.tendered),
        change: money(fraction.change),
        state: cash ? 'aprobado' : 'pendiente',
        key: input.key,
        reference: null,
        checks: 0,
        manuallyResolved: false,
        lateApprovedAt: null,
        authorizationId: null,
        at: actor.at,
      };
      await this.deps.collections.insert(collection);
      await this.deps.collections.addPayment(actor.tenantId, payment);
      if (cash) {
        await this.apply(actor, collection, payment, charged(payment));
        return { view: await this.view(actor.tenantId, collection) };
      }
      // La parte de la deuda queda apartada: otro cobro simultáneo no la puede tomar (RF-152).
      if (!(await this.deps.customers.commit(actor.tenantId, customer.id, amount))) {
        throw new DomainError('COBRO_EXCEDE_DEUDA', 'El cobro supera lo que adeuda el cliente.');
      }
      await this.schedule(actor.tenantId, payment, actor.at, 0);
      return { collection, payment };
    });
    if ('view' in started) return started.view;

    const { collection, payment } = started;
    const answer = await askGateway(() =>
      this.deps.gateway.charge({
        tenantId: collection.tenantId,
        key: input.key,
        amount: charged(payment),
        description: `Cobro de cuenta corriente de ${collection.customerName}`,
      }),
    );
    return this.inTenant(context, async (actor) => {
      const current = await this.deps.collections.find(actor.tenantId, collection.id, true);
      if (!current) throw new Error('El cobro desapareció.');
      const latest = await this.deps.collections.paymentOf(actor.tenantId, collection.id);
      if (latest) {
        await this.settle(
          actor,
          current,
          latest,
          answer.outcome === 'sin_respuesta' ? 'por_verificar' : answer.outcome,
          answer.reference,
        );
      }
      const after = await this.deps.collections.find(actor.tenantId, collection.id, false);
      return this.view(actor.tenantId, after ?? current);
    });
  }

  private async schedule(tenantId: string, payment: CollectionPayment, at: Date, checks: number) {
    const runAt = nextVerification(at, checks, at);
    if (runAt) await scheduleCheck(this.deps.jobs, tenantId, payment.id, runAt);
  }
}

function assertWithinDebt(customer: Customer, amount: string) {
  const debt = cents(customer.balance) - cents(customer.committed);
  if (cents(amount) > debt) {
    throw new DomainError(
      'COBRO_EXCEDE_DEUDA',
      `El cobro supera lo que adeuda el cliente: $ ${money(debt > 0n ? debt : 0n)}.`,
    );
  }
}

const scheduleCheck = (jobs: JobScheduler, tenantId: string, paymentId: string, runAt: Date) =>
  jobs.schedule({
    type: COLLECTION_VERIFICATION_JOB,
    key: `${paymentId}:${runAt.toISOString()}`,
    runAt,
    payload: { tenantId, paymentId },
  });

// Cobros del VO que esperan un resultado, para mostrarlos en el POS.
export class ListPendingCollections extends CollectionUseCase {
  async execute(context: SecurityContext): Promise<CollectionView[]> {
    return this.inTenant(context, async (actor) => {
      const views: CollectionView[] = [];
      for (const c of await this.deps.collections.pendingOfSeller(actor.tenantId, actor.userId)) {
        views.push(await this.view(actor.tenantId, c));
      }
      return views;
    });
  }
}

// Resolución manual con el PIN de un AS, cuando la pasarela sigue sin responder (RF-126).
export class ResolveCollection extends CollectionUseCase {
  async execute(
    context: SecurityContext,
    id: string,
    input: { result: 'aprobado' | 'rechazado'; authorizationId: string },
  ): Promise<CollectionView> {
    return this.inTenant(context, async (actor) => {
      const collection = await this.deps.collections.find(actor.tenantId, id, true);
      if (!collection) return this.deps.access.notFound(context, 'cobro_cuenta_corriente', id);
      if (collection.sellerId !== actor.userId) throw forbiddenError();
      const payment = await this.deps.collections.paymentOf(actor.tenantId, id);
      if (payment?.state !== 'por_verificar') {
        throw new ApplicationError('conflict', 'PAGO_RESUELTO', 'El cobro ya tiene un resultado.');
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
      await this.settle(actor, collection, payment, input.result, null, {
        manuallyResolved: true,
        authorizationId: input.authorizationId,
      });
      const after = await this.deps.collections.find(actor.tenantId, id, false);
      return this.view(actor.tenantId, after ?? collection);
    });
  }
}

// Worker: consulta a la pasarela los cobros sin resultado y vigila una aprobación tardía.
export class CollectionVerification extends CollectionUseCase {
  async verify(tenantId: string, paymentId: string): Promise<void> {
    const payment = await this.deps.uow.run(
      () => this.deps.collections.paymentById(tenantId, paymentId),
      { tenantId },
    );
    if (!payment?.key || !isOpen(payment)) return;
    const key = payment.key;
    const answer = await askGateway(() => this.deps.gateway.check({ tenantId, key }));
    await this.deps.uow.run(
      async () => {
        const collection = await this.deps.collections.find(tenantId, payment.collectionId, true);
        const current = await this.deps.collections.paymentById(tenantId, paymentId);
        if (!collection || !current || !isOpen(current)) return;
        const now = this.deps.clock.now();
        const actor: Actor = { tenantId, userId: collection.sellerId, at: now };
        const checked = { ...current, checks: current.checks + 1 };
        if (current.state === 'rechazado') {
          if (answer.outcome === 'aprobado') {
            await this.deps.collections.savePayment(tenantId, { ...checked, lateApprovedAt: now });
            await this.deps.alerts.add({
              tenantId,
              branchId: collection.branchId,
              paymentId: current.id,
              detail: { monto: charged(current), cliente: collection.customerName },
              at: now,
            });
            return;
          }
          await this.deps.collections.savePayment(tenantId, checked);
        } else if (answer.outcome === 'sin_respuesta') {
          await this.settle(actor, collection, current, 'por_verificar', null, {
            checks: checked.checks,
          });
        } else {
          await this.settle(actor, collection, current, answer.outcome, answer.reference, {
            checks: checked.checks,
          });
          return;
        }
        const runAt = nextVerification(current.at, checked.checks, now);
        if (runAt) await scheduleCheck(this.deps.jobs, tenantId, current.id, runAt);
      },
      { tenantId },
    );
  }

  // Cobros sin resultado de un turno: impiden cerrarlo (D-86).
  async pendingOfShift(tenantId: string, shiftId: string) {
    const pending = await this.deps.collections.pendingOfShift(tenantId, shiftId);
    return pending.map((c) => ({
      id: c.id,
      label: `cobro de ${c.customerName} por $ ${c.amount}`,
    }));
  }
}

const isOpen = (p: CollectionPayment) =>
  p.state === 'pendiente' ||
  p.state === 'por_verificar' ||
  (p.state === 'rechazado' && p.manuallyResolved && p.lateApprovedAt === null);
