// Puertos de salida del módulo de proveedores. Los repositorios trabajan dentro de una unidad de
// trabajo con el comercio fijado (seguridad a nivel de fila) y además filtran por comercio.
import type { PaymentMethod, PurchaseLine, ReceivedLine, Supplier } from '../dominio/suppliers.js';

export interface StatementEntry {
  type: 'compra' | 'pago';
  id: string;
  at: Date;
  // Positivo en una compra (aumenta la deuda) y positivo también en un pago (la reduce).
  amount: string;
  reference: string | null;
}

export interface SupplierRepository {
  list(tenantId: string, includeInactive: boolean): Promise<Supplier[]>;
  findById(tenantId: string, id: string): Promise<Supplier | undefined>;
  // Con bloqueo de fila: dos pagos simultáneos comparan contra el mismo saldo actualizado.
  findForUpdate(tenantId: string, id: string): Promise<Supplier | undefined>;
  cuitInUse(tenantId: string, cuit: string, exceptId?: string): Promise<boolean>;
  insert(supplier: Supplier, at: Date): Promise<void>;
  update(supplier: Supplier): Promise<void>;
  deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void>;
  // Suma (o resta, con un monto negativo) al saldo adeudado y devuelve el saldo nuevo.
  addToBalance(tenantId: string, id: string, delta: string): Promise<string>;
  statement(tenantId: string, id: string, limit: number): Promise<StatementEntry[]>;
}

export interface ImportRecord {
  id: string;
  tenantId: string;
  supplierId: string;
  ok: number;
  created: number;
  updated: number;
  errors: { line: number; barcode: string; reason: string }[];
  userId: string;
  at: Date;
}

export interface ImportLog {
  insert(record: ImportRecord): Promise<void>;
}

export interface PurchaseItem extends PurchaseLine {
  itemId: string;
  productName: string;
  received: string | null;
  difference: string | null;
}

export interface Purchase {
  id: string;
  tenantId: string;
  supplierId: string;
  supplierName: string;
  branchId: string;
  branchName: string;
  state: 'pendiente' | 'recibida';
  invoice: string | null;
  total: string;
  registeredAt: Date;
  receivedAt: Date | null;
  items: PurchaseItem[];
}

export interface NewPurchase {
  id: string;
  tenantId: string;
  supplierId: string;
  branchId: string;
  invoice: string | null;
  total: string;
  lines: (PurchaseLine & { itemId: string })[];
}

export interface PurchaseRepository {
  insert(purchase: NewPurchase, by: string, at: Date): Promise<void>;
  find(tenantId: string, id: string, lock?: boolean): Promise<Purchase | undefined>;
  list(
    tenantId: string,
    filter: { supplierId?: string; branchIds?: readonly string[]; pendingOnly?: boolean },
    limit: number,
  ): Promise<Purchase[]>;
  markReceived(
    tenantId: string,
    id: string,
    lines: readonly ReceivedLine[],
    by: string,
    at: Date,
  ): Promise<void>;
  pendingForProduct(tenantId: string, productId: string): Promise<number>;
}

export interface Payment {
  id: string;
  tenantId: string;
  supplierId: string;
  amount: string;
  method: PaymentMethod;
  reference: string;
  confirmedExcess: boolean;
  userId: string;
  at: Date;
}

export interface PaymentRepository {
  insert(payment: Payment): Promise<void>;
}

export interface Actor {
  tenantId: string;
  userId: string;
  at: Date;
}

// Lo provee el catálogo: productos, costos de compra e importación con recálculo de precios.
export interface CatalogGateway {
  products(
    tenantId: string,
    ids: readonly string[],
  ): Promise<{ id: string; name: string; type: 'simple' | 'combo'; isActive: boolean }[]>;
  applyPurchaseCosts(
    actor: Actor,
    changes: readonly { productId: string; cost: string }[],
  ): Promise<number>;
  importRows(
    actor: Actor,
    rows: readonly {
      line: number;
      barcode: string;
      name: string;
      cost: string;
      category: string;
    }[],
  ): Promise<{
    outcomes: (
      | { line: number; barcode: string; outcome: 'creado' | 'actualizado'; productId: string }
      | { line: number; barcode: string; outcome: 'error'; reason: string }
    )[];
    recalculated: number;
  }>;
}

// Lo provee el inventario: ingreso de lo recibido al stock disponible de la sucursal.
export interface StockIntake {
  receive(
    actor: Actor,
    branchId: string,
    product: { id: string; name: string },
    quantity: string,
    reference: string,
  ): Promise<void>;
}

export interface BranchDirectory {
  find(tenantId: string, branchId: string): Promise<{ id: string; name: string } | undefined>;
}
