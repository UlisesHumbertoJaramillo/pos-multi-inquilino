// Casos de uso de proveedores, importación de catálogo, compras, recepción y pagos (T-105 a T-109;
// RF-034 a RF-038, RF-133). Todo es del AC salvo la recepción, que hace un AS de la sucursal de
// destino (§5.18).
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { Action } from '../../../compartido/aplicacion/permissions.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import { parseCatalogCsv } from '../dominio/catalog-import.js';
import {
  assertNoBalance,
  assertPaymentWithinBalance,
  assertReference,
  assertSupplierName,
  negate,
  normalizeAmount,
  normalizeContact,
  normalizeCuit,
  type PaymentMethod,
  purchaseLines,
  settlePurchaseReception,
  type Supplier,
} from '../dominio/suppliers.js';
import type {
  Actor,
  BranchDirectory,
  CatalogGateway,
  ImportLog,
  ImportRecord,
  Payment,
  PaymentRepository,
  Purchase,
  PurchaseRepository,
  StatementEntry,
  StockIntake,
  SupplierRepository,
} from './ports.js';

export interface SupplierDependencies {
  uow: UnitOfWork;
  suppliers: SupplierRepository;
  imports: ImportLog;
  purchases: PurchaseRepository;
  payments: PaymentRepository;
  catalog: CatalogGateway;
  stock: StockIntake;
  branches: BranchDirectory;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
  ids: IdGenerator;
}

const MANAGE = 'proveedores.gestionar' as const;
const RECEIVE = 'compras.recibir' as const;
const MAX_LIST = 200;

abstract class SupplierUseCase {
  constructor(protected readonly deps: SupplierDependencies) {}

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

  protected async supplier(
    context: SecurityContext,
    actor: Actor,
    id: string,
    lock = false,
  ): Promise<Supplier> {
    const found = lock
      ? await this.deps.suppliers.findForUpdate(actor.tenantId, id)
      : await this.deps.suppliers.findById(actor.tenantId, id);
    if (!found) return this.deps.access.notFound(context, 'proveedor', id);
    return found;
  }

  protected async assertCuitFree(actor: Actor, cuit: string | null, exceptId?: string) {
    if (cuit !== null && (await this.deps.suppliers.cuitInUse(actor.tenantId, cuit, exceptId))) {
      throw new DomainError('CUIT_EN_USO', 'Ya hay un proveedor activo con ese CUIT.');
    }
  }

  protected activeSupplier(supplier: Supplier): Supplier {
    if (!supplier.isActive) {
      throw new ApplicationError('conflict', 'YA_DADO_DE_BAJA', 'El proveedor está dado de baja.');
    }
    return supplier;
  }

  protected async record(
    actor: Actor,
    role: 'AC' | 'AS',
    action: string,
    entity: string,
    entityId: string,
    before: unknown,
    after: unknown,
    branchId: string | null = null,
  ) {
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      branchId,
      userId: actor.userId,
      activeRole: role,
      action,
      entity,
      entityId,
      before,
      after,
    });
  }
}

export interface SupplierInput {
  name: string;
  cuit: string | null;
  contact: string | null;
}

export class ListSuppliers extends SupplierUseCase {
  async execute(context: SecurityContext, includeInactive = false): Promise<Supplier[]> {
    return this.inTenant(context, MANAGE, (actor) =>
      this.deps.suppliers.list(actor.tenantId, includeInactive),
    );
  }
}

export class CreateSupplier extends SupplierUseCase {
  async execute(context: SecurityContext, input: SupplierInput): Promise<Supplier> {
    return this.inTenant(context, MANAGE, async (actor) => {
      const supplier: Supplier = {
        id: this.deps.ids.next(),
        tenantId: actor.tenantId,
        name: assertSupplierName(input.name),
        cuit: normalizeCuit(input.cuit),
        contact: normalizeContact(input.contact),
        balance: '0.00',
        isActive: true,
      };
      await this.assertCuitFree(actor, supplier.cuit);
      await this.deps.suppliers.insert(supplier, actor.at);
      await this.record(actor, 'AC', 'proveedor_alta', 'proveedor', supplier.id, null, supplier);
      return supplier;
    });
  }
}

export class UpdateSupplier extends SupplierUseCase {
  async execute(
    context: SecurityContext,
    id: string,
    changes: Partial<SupplierInput>,
  ): Promise<Supplier> {
    return this.inTenant(context, MANAGE, async (actor) => {
      const current = this.activeSupplier(await this.supplier(context, actor, id));
      const next: Supplier = {
        ...current,
        ...(changes.name === undefined ? {} : { name: assertSupplierName(changes.name) }),
        ...(changes.cuit === undefined ? {} : { cuit: normalizeCuit(changes.cuit) }),
        ...(changes.contact === undefined ? {} : { contact: normalizeContact(changes.contact) }),
      };
      if (next.cuit !== current.cuit) await this.assertCuitFree(actor, next.cuit, id);
      await this.deps.suppliers.update(next);
      await this.record(actor, 'AC', 'proveedor_modificado', 'proveedor', id, current, next);
      return next;
    });
  }
}

// Un proveedor con saldo no se da de baja (RF-148).
export class DeactivateSupplier extends SupplierUseCase {
  async execute(context: SecurityContext, id: string): Promise<void> {
    await this.inTenant(context, MANAGE, async (actor) => {
      const current = this.activeSupplier(await this.supplier(context, actor, id, true));
      assertNoBalance(current);
      await this.deps.suppliers.deactivate(actor.tenantId, id, actor.userId, actor.at);
      await this.record(actor, 'AC', 'proveedor_baja', 'proveedor', id, current, {
        ...current,
        isActive: false,
      });
    });
  }
}

export class GetSupplierStatement extends SupplierUseCase {
  async execute(
    context: SecurityContext,
    id: string,
  ): Promise<{ supplier: Supplier; entries: StatementEntry[] }> {
    return this.inTenant(context, MANAGE, async (actor) => ({
      supplier: await this.supplier(context, actor, id),
      entries: await this.deps.suppliers.statement(actor.tenantId, id, MAX_LIST),
    }));
  }
}

export interface ImportResult {
  id: string;
  ok: number;
  created: number;
  updated: number;
  recalculated: number;
  errors: { line: number; barcode: string; reason: string }[];
}

// Importación de catálogo (RF-035, D-49): aplica las filas válidas, informa las demás y deja una
// sola entrada de auditoría con su detalle, incluido el recálculo de precios que provoca.
export class ImportCatalog extends SupplierUseCase {
  async execute(context: SecurityContext, supplierId: string, csv: string): Promise<ImportResult> {
    return this.inTenant(context, MANAGE, async (actor) => {
      const supplier = this.activeSupplier(await this.supplier(context, actor, supplierId));
      const parsed = parseCatalogCsv(csv);
      if (parsed.rows.length === 0 && parsed.errors.length === 0) {
        throw new DomainError('CSV_INVALIDO', 'El archivo no tiene filas para importar.');
      }
      const { outcomes, recalculated } = await this.deps.catalog.importRows(actor, parsed.rows);
      const errors = [
        ...parsed.errors,
        ...outcomes.flatMap((o) =>
          o.outcome === 'error' ? [{ line: o.line, barcode: o.barcode, reason: o.reason }] : [],
        ),
      ].sort((a, b) => a.line - b.line);
      const record: ImportRecord = {
        id: this.deps.ids.next(),
        tenantId: actor.tenantId,
        supplierId,
        ok: outcomes.filter((o) => o.outcome !== 'error').length,
        created: outcomes.filter((o) => o.outcome === 'creado').length,
        updated: outcomes.filter((o) => o.outcome === 'actualizado').length,
        errors,
        userId: actor.userId,
        at: actor.at,
      };
      await this.deps.imports.insert(record);
      await this.record(
        actor,
        'AC',
        'catalogo_importado',
        'importacion_catalogo',
        record.id,
        null,
        {
          proveedor: supplier.name,
          filasOk: record.ok,
          creados: record.created,
          actualizados: record.updated,
          preciosRecalculados: recalculated,
          productos: outcomes.flatMap((o) =>
            o.outcome === 'error'
              ? []
              : [{ fila: o.line, codigoBarras: o.barcode, resultado: o.outcome }],
          ),
          errores: errors,
        },
      );
      return {
        id: record.id,
        ok: record.ok,
        created: record.created,
        updated: record.updated,
        recalculated,
        errors,
      };
    });
  }
}

export class ListPurchases extends SupplierUseCase {
  async execute(context: SecurityContext, supplierId?: string): Promise<Purchase[]> {
    return this.inTenant(context, MANAGE, (actor) =>
      this.deps.purchases.list(
        actor.tenantId,
        supplierId === undefined ? {} : { supplierId },
        MAX_LIST,
      ),
    );
  }
}

export class GetPurchase extends SupplierUseCase {
  async execute(context: SecurityContext, id: string): Promise<Purchase> {
    return this.inTenant(context, MANAGE, async (actor) => {
      const found = await this.deps.purchases.find(actor.tenantId, id);
      if (!found) return this.deps.access.notFound(context, 'compra', id);
      return found;
    });
  }
}

// Compra a crédito (RF-036, D-25): sube la deuda, el costo de cada producto pasa a ser el de esta
// compra (D-66) y recalcula sus precios, y queda pendiente de recepción en la sucursal de destino.
export class RegisterPurchase extends SupplierUseCase {
  async execute(
    context: SecurityContext,
    input: {
      supplierId: string;
      branchId: string;
      invoice: string | null;
      items: { productId: string; quantity: string; unitCost: string }[];
    },
  ): Promise<Purchase> {
    return this.inTenant(context, MANAGE, async (actor) => {
      this.activeSupplier(await this.supplier(context, actor, input.supplierId, true));
      const branch = await this.deps.branches.find(actor.tenantId, input.branchId);
      if (!branch) return this.deps.access.notFound(context, 'sucursal', input.branchId);
      const { lines, total } = purchaseLines(input.items);
      const products = new Map(
        (
          await this.deps.catalog.products(
            actor.tenantId,
            lines.map((l) => l.productId),
          )
        ).map((p) => [p.id, p]),
      );
      for (const line of lines) {
        const product = products.get(line.productId);
        if (!product) return this.deps.access.notFound(context, 'producto', line.productId);
        if (product.type === 'combo') {
          throw new DomainError(
            'ES_UN_COMBO',
            'Un combo no se compra: se compran sus componentes.',
          );
        }
        if (!product.isActive) {
          throw new DomainError('PRODUCTO_DADO_DE_BAJA', `«${product.name}» está dado de baja.`);
        }
      }
      const invoice = input.invoice?.trim() ? assertReference(input.invoice) : null;
      const id = this.deps.ids.next();
      await this.deps.purchases.insert(
        {
          id,
          tenantId: actor.tenantId,
          supplierId: input.supplierId,
          branchId: input.branchId,
          invoice,
          total,
          lines: lines.map((line) => ({ ...line, itemId: this.deps.ids.next() })),
        },
        actor.userId,
        actor.at,
      );
      const balance = await this.deps.suppliers.addToBalance(
        actor.tenantId,
        input.supplierId,
        total,
      );
      const recalculated = await this.deps.catalog.applyPurchaseCosts(
        actor,
        lines.map((line) => ({ productId: line.productId, cost: line.unitCost })),
      );
      await this.record(
        actor,
        'AC',
        'compra_registrada',
        'compra',
        id,
        null,
        {
          proveedorId: input.supplierId,
          sucursalId: input.branchId,
          total,
          saldo: balance,
          preciosRecalculados: recalculated,
          items: lines,
        },
        input.branchId,
      );
      const purchase = await this.deps.purchases.find(actor.tenantId, id);
      if (!purchase) throw new Error('No se encontró la compra recién registrada.');
      return purchase;
    });
  }
}

// Compras pendientes de recepción en las sucursales del AS.
export class ListPendingReceptions extends SupplierUseCase {
  async execute(context: SecurityContext): Promise<Purchase[]> {
    return this.inTenant(context, RECEIVE, (actor) =>
      this.deps.purchases.list(
        actor.tenantId,
        { branchIds: context.branchIds, pendingOnly: true },
        MAX_LIST,
      ),
    );
  }
}

// Recepción (RF-133): lo recibido entra al stock disponible de la sucursal de destino y la
// diferencia con lo comprado queda registrada. La deuda no cambia (D-67).
export class ReceivePurchase extends SupplierUseCase {
  async execute(
    context: SecurityContext,
    id: string,
    received: { productId: string; quantity: string }[],
  ): Promise<Purchase> {
    return this.inTenant(context, RECEIVE, async (actor) => {
      const purchase = await this.deps.purchases.find(actor.tenantId, id, true);
      if (!purchase) return this.deps.access.notFound(context, 'compra', id);
      await this.deps.access.check(context, RECEIVE, { branchId: purchase.branchId });
      if (purchase.state !== 'pendiente') {
        throw new DomainError('COMPRA_RECIBIDA', 'La compra ya fue recibida.');
      }
      const lines = settlePurchaseReception(
        purchase.items.map((item) => ({
          itemId: item.itemId,
          productId: item.productId,
          quantity: item.quantity,
        })),
        received,
      );
      for (const line of lines) {
        if (Number(line.received) === 0) continue;
        const item = purchase.items.find((i) => i.itemId === line.itemId);
        await this.deps.stock.receive(
          actor,
          purchase.branchId,
          { id: line.productId, name: item?.productName ?? line.productId },
          line.received,
          purchase.id,
        );
      }
      await this.deps.purchases.markReceived(actor.tenantId, id, lines, actor.userId, actor.at);
      await this.record(
        actor,
        'AS',
        'compra_recibida',
        'compra',
        id,
        { estado: 'pendiente' },
        { estado: 'recibida', items: lines },
        purchase.branchId,
      );
      const after = await this.deps.purchases.find(actor.tenantId, id);
      if (!after) throw new Error('No se encontró la compra recibida.');
      return after;
    });
  }
}

// Pago a un proveedor (RF-037, RF-038): baja la deuda y conserva el comprobante. Si supera la
// deuda, hace falta confirmarlo.
export class RegisterPayment extends SupplierUseCase {
  async execute(
    context: SecurityContext,
    supplierId: string,
    input: { amount: string; method: PaymentMethod; reference: string; confirmExcess: boolean },
  ): Promise<{ payment: Payment; balance: string }> {
    return this.inTenant(context, MANAGE, async (actor) => {
      const supplier = await this.supplier(context, actor, supplierId, true);
      const amount = normalizeAmount(input.amount);
      const { exceeds } = assertPaymentWithinBalance(supplier.balance, amount, input.confirmExcess);
      const payment: Payment = {
        id: this.deps.ids.next(),
        tenantId: actor.tenantId,
        supplierId,
        amount,
        method: input.method,
        reference: assertReference(input.reference),
        confirmedExcess: exceeds,
        userId: actor.userId,
        at: actor.at,
      };
      await this.deps.payments.insert(payment);
      const balance = await this.deps.suppliers.addToBalance(
        actor.tenantId,
        supplierId,
        negate(amount),
      );
      await this.record(
        actor,
        'AC',
        'pago_proveedor',
        'proveedor',
        supplierId,
        { saldo: supplier.balance },
        {
          saldo: balance,
          pago: payment,
        },
      );
      return { payment, balance };
    });
  }
}
