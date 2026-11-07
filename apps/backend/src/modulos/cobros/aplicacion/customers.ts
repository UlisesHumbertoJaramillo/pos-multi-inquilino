// Clientes del comercio y su crédito (T-167, T-168, T-170; RF-072, RF-073, RF-132, RF-144, D-24,
// D-35). Los gestiona el AS y se comparten en todas las sucursales.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import { cents, creditRefund, money } from '../../calculo/aplicacion/engine.js';
import {
  assertNoDebt,
  availableCredit,
  type CustomerInput,
  normalizeCreditLimit,
  normalizeCustomer,
} from '../dominio/customers.js';
import type { Actor, Customer, CustomerRepository } from './ports.js';

export interface CustomerDependencies {
  uow: UnitOfWork;
  customers: CustomerRepository;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
  ids: IdGenerator;
}

const MANAGE = 'clientes.gestionar' as const;
const DUPLICATE = 'Ya hay un cliente activo con ese documento.';

abstract class CustomerUseCase {
  constructor(protected readonly deps: CustomerDependencies) {}

  protected async inTenant<T>(
    context: SecurityContext,
    work: (actor: Actor) => Promise<T>,
  ): Promise<T> {
    await this.deps.access.check(context, MANAGE);
    const tenantId = this.deps.access.requireTenant(context);
    return this.deps.uow.run(
      () => work({ tenantId, userId: context.userId, at: this.deps.clock.now() }),
      { tenantId },
    );
  }

  protected async existing(context: SecurityContext, actor: Actor, id: string): Promise<Customer> {
    const customer = await this.deps.customers.find(actor.tenantId, id, true);
    if (!customer?.isActive) return this.deps.access.notFound(context, 'cliente', id);
    return customer;
  }

  protected async record(
    actor: Actor,
    action: string,
    customer: Customer,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ) {
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      branchId: null,
      userId: actor.userId,
      activeRole: 'AS',
      action,
      entity: 'cliente',
      entityId: customer.id,
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    });
  }
}

export class ListCustomers extends CustomerUseCase {
  async execute(context: SecurityContext, includeInactive: boolean): Promise<Customer[]> {
    return this.inTenant(context, (actor) =>
      this.deps.customers.list(actor.tenantId, includeInactive),
    );
  }
}

export class CreateCustomer extends CustomerUseCase {
  async execute(context: SecurityContext, input: CustomerInput): Promise<Customer> {
    const data = normalizeCustomer(input);
    return this.inTenant(context, async (actor) => {
      const customer: Customer = {
        ...data,
        id: this.deps.ids.next(),
        tenantId: actor.tenantId,
        hasAccount: false,
        creditLimit: '0.00',
        balance: '0.00',
        committed: '0.00',
        isActive: true,
      };
      if (!(await this.deps.customers.insert(customer, actor.at))) {
        throw new DomainError('CLIENTE_DUPLICADO', DUPLICATE);
      }
      await this.record(actor, 'cliente_creado', customer, null, { nombre: customer.name });
      return customer;
    });
  }
}

export class UpdateCustomer extends CustomerUseCase {
  async execute(context: SecurityContext, id: string, input: CustomerInput): Promise<Customer> {
    const data = normalizeCustomer(input);
    return this.inTenant(context, async (actor) => {
      const customer = await this.existing(context, actor, id);
      const next = { ...customer, ...data };
      if (!(await this.deps.customers.update(next))) {
        throw new DomainError('CLIENTE_DUPLICADO', DUPLICATE);
      }
      await this.record(
        actor,
        'cliente_modificado',
        next,
        { nombre: customer.name, condicionFiscal: customer.fiscalCondition },
        { nombre: next.name, condicionFiscal: next.fiscalCondition },
      );
      return next;
    });
  }
}

// Límite de crédito (RF-072). Sin cuenta corriente, el límite vuelve a cero.
export class SetCreditLimit extends CustomerUseCase {
  async execute(
    context: SecurityContext,
    id: string,
    input: { hasAccount: boolean; limit: string },
  ): Promise<Customer> {
    const limit = input.hasAccount ? normalizeCreditLimit(input.limit) : '0.00';
    return this.inTenant(context, async (actor) => {
      const customer = await this.existing(context, actor, id);
      if (!input.hasAccount) assertNoDebt(customer.balance);
      const next = { ...customer, hasAccount: input.hasAccount, creditLimit: limit };
      await this.deps.customers.update(next);
      await this.record(
        actor,
        'limite_credito_fijado',
        next,
        { cuentaCorriente: customer.hasAccount, limite: customer.creditLimit },
        { cuentaCorriente: next.hasAccount, limite: next.creditLimit },
      );
      return next;
    });
  }
}

// Baja lógica (RN-02): un cliente con deuda se conserva.
export class DeactivateCustomer extends CustomerUseCase {
  async execute(context: SecurityContext, id: string): Promise<void> {
    await this.inTenant(context, async (actor) => {
      const customer = await this.existing(context, actor, id);
      assertNoDebt(customer.balance);
      await this.deps.customers.deactivate(actor.tenantId, id, actor.userId, actor.at);
      await this.record(actor, 'cliente_dado_de_baja', customer, null, null);
    });
  }
}

// Devolución o anulación de una venta a crédito (RF-086, D-29): el saldo baja hasta cero, sin tocar
// lo apartado por cobros sin resultado; el excedente se reintegra en efectivo.
export interface CreditReturn {
  reduced: string;
  excess: string;
}

export type CreditCharge = { ok: true; balance: string } | { ok: false; available: string };

// Crédito para las ventas (RF-073, RF-074, RF-144). Corre dentro de la transacción de la venta.
export class CustomerCredit {
  constructor(private readonly deps: Pick<CustomerDependencies, 'customers' | 'ids'>) {}

  search(tenantId: string, query: string) {
    return this.deps.customers.search(tenantId, query);
  }

  find(tenantId: string, id: string) {
    return this.deps.customers.find(tenantId, id, false);
  }

  // Saldo que se puede bajar: lo adeudado menos lo apartado por cobros sin resultado.
  async freeBalance(tenantId: string, id: string): Promise<string> {
    const customer = await this.deps.customers.find(tenantId, id, false);
    if (!customer) return '0.00';
    const free = cents(customer.balance) - cents(customer.committed);
    return money(free > 0n ? free : 0n);
  }

  async refund(
    actor: Actor,
    input: { customerId: string; amount: string; saleId: string; type: 'devolucion' | 'anulacion' },
  ): Promise<CreditReturn> {
    const customer = await this.deps.customers.find(actor.tenantId, input.customerId, true);
    const free = customer ? cents(customer.balance) - cents(customer.committed) : 0n;
    const split = creditRefund(cents(input.amount), free > 0n ? free : 0n);
    if (customer && split.balanceReduction > 0n) {
      const reduced = money(split.balanceReduction);
      const balance = await this.deps.customers.reduceBalance(actor.tenantId, customer.id, reduced);
      if (balance === null) throw new Error('No se pudo bajar el saldo del cliente.');
      await this.deps.customers.addMovement(actor, {
        id: this.deps.ids.next(),
        customerId: customer.id,
        type: input.type,
        amount: reduced,
        balance,
        saleId: input.saleId,
        collectionId: null,
      });
    }
    return { reduced: money(split.balanceReduction), excess: money(split.cashExcess) };
  }

  async charge(
    actor: Actor,
    input: { customerId: string; amount: string; saleId: string; allowExcess: boolean },
  ): Promise<CreditCharge> {
    const customer = await this.deps.customers.find(actor.tenantId, input.customerId, false);
    if (!customer?.isActive || !customer.hasAccount) {
      throw new DomainError(
        'CLIENTE_SIN_CREDITO',
        'El cliente está dado de baja o no tiene cuenta corriente.',
      );
    }
    const balance = await this.deps.customers.increaseBalance(
      actor.tenantId,
      customer.id,
      input.amount,
      input.allowExcess,
    );
    if (balance === null) {
      const current = await this.deps.customers.find(actor.tenantId, customer.id, false);
      return {
        ok: false,
        available: availableCredit(customer.creditLimit, current?.balance ?? customer.balance),
      };
    }
    await this.deps.customers.addMovement(actor, {
      id: this.deps.ids.next(),
      customerId: customer.id,
      type: 'venta',
      amount: input.amount,
      balance,
      saleId: input.saleId,
      collectionId: null,
    });
    return { ok: true, balance };
  }
}
