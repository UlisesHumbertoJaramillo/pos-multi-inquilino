// Repositorios PostgreSQL del módulo de proveedores. Tablas aisladas por comercio: se usan dentro
// de una unidad de trabajo con el comercio fijado, y además cada consulta filtra por comercio.
import { randomUUID } from 'node:crypto';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type { ReceivedLine, Supplier } from '../dominio/suppliers.js';
import type {
  BranchDirectory,
  ImportLog,
  ImportRecord,
  NewPurchase,
  Payment,
  PaymentRepository,
  Purchase,
  PurchaseRepository,
  StatementEntry,
  SupplierRepository,
} from '../aplicacion/ports.js';

interface SupplierRow {
  id: string;
  tenant_id: string;
  razon_social: string;
  cuit: string | null;
  contacto: string | null;
  saldo_adeudado: string;
  is_active: boolean;
}

const SUPPLIER_COLUMNS = 'id, tenant_id, razon_social, cuit, contacto, saldo_adeudado, is_active';

const toSupplier = (row: SupplierRow): Supplier => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.razon_social,
  cuit: row.cuit,
  contact: row.contacto,
  balance: row.saldo_adeudado,
  isActive: row.is_active,
});

export class PgSupplierRepository implements SupplierRepository {
  constructor(private readonly db: PgDatabase) {}

  async list(tenantId: string, includeInactive: boolean): Promise<Supplier[]> {
    const result = await this.db.query<SupplierRow>(
      `SELECT ${SUPPLIER_COLUMNS} FROM proveedor
        WHERE tenant_id = $1 AND ($2 OR is_active) ORDER BY razon_social`,
      [tenantId, includeInactive],
    );
    return result.rows.map(toSupplier);
  }

  async findById(tenantId: string, id: string): Promise<Supplier | undefined> {
    return this.findOne(tenantId, id, '');
  }

  async findForUpdate(tenantId: string, id: string): Promise<Supplier | undefined> {
    return this.findOne(tenantId, id, ' FOR UPDATE');
  }

  async cuitInUse(tenantId: string, cuit: string, exceptId?: string): Promise<boolean> {
    const result = await this.db.query<{ used: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM proveedor
                       WHERE tenant_id = $1 AND cuit = $2 AND is_active
                         AND id <> coalesce($3::uuid, '00000000-0000-0000-0000-000000000000')) AS used`,
      [tenantId, cuit, exceptId ?? null],
    );
    return result.rows[0]?.used === true;
  }

  async insert(s: Supplier, at: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO proveedor (id, tenant_id, razon_social, cuit, contacto, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [s.id, s.tenantId, s.name, s.cuit, s.contact, at],
    );
  }

  async update(s: Supplier): Promise<void> {
    await this.db.query(
      `UPDATE proveedor SET razon_social = $3, cuit = $4, contacto = $5
        WHERE tenant_id = $1 AND id = $2`,
      [s.tenantId, s.id, s.name, s.cuit, s.contact],
    );
  }

  async deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE proveedor SET is_active = false, desactivado_en = $3, desactivado_por = $4
        WHERE tenant_id = $1 AND id = $2 AND is_active`,
      [tenantId, id, at, by],
    );
  }

  async addToBalance(tenantId: string, id: string, delta: string): Promise<string> {
    const result = await this.db.query<{ saldo_adeudado: string }>(
      `UPDATE proveedor SET saldo_adeudado = saldo_adeudado + $3
        WHERE tenant_id = $1 AND id = $2 RETURNING saldo_adeudado`,
      [tenantId, id, delta],
    );
    const row = result.rows[0];
    if (!row) throw new Error('No se encontró el proveedor.');
    return row.saldo_adeudado;
  }

  async statement(tenantId: string, id: string, limit: number): Promise<StatementEntry[]> {
    const result = await this.db.query<{
      tipo: 'compra' | 'pago';
      id: string;
      momento: Date;
      importe: string;
      referencia: string | null;
    }>(
      `SELECT * FROM (
         SELECT 'compra' AS tipo, id, registrada_en AS momento, total AS importe,
                comprobante AS referencia
           FROM compra WHERE tenant_id = $1 AND proveedor_id = $2
         UNION ALL
         SELECT 'pago', id, momento, monto, comprobante_ref
           FROM pago_proveedor WHERE tenant_id = $1 AND proveedor_id = $2
       ) movimientos
       ORDER BY momento DESC, id
       LIMIT $3`,
      [tenantId, id, limit],
    );
    return result.rows.map((row) => ({
      type: row.tipo,
      id: row.id,
      at: row.momento,
      amount: row.importe,
      reference: row.referencia,
    }));
  }

  private async findOne(tenantId: string, id: string, lock: string) {
    const result = await this.db.query<SupplierRow>(
      `SELECT ${SUPPLIER_COLUMNS} FROM proveedor WHERE tenant_id = $1 AND id = $2${lock}`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toSupplier(row) : undefined;
  }
}

export class PgImportLog implements ImportLog {
  constructor(private readonly db: PgDatabase) {}

  async insert(r: ImportRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO importacion_catalogo (id, tenant_id, proveedor_id, filas_ok, creados,
         actualizados, filas_error, usuario_id, momento)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        r.id,
        r.tenantId,
        r.supplierId,
        r.ok,
        r.created,
        r.updated,
        JSON.stringify(r.errors),
        r.userId,
        r.at,
      ],
    );
  }
}

interface PurchaseRow {
  id: string;
  tenant_id: string;
  proveedor_id: string;
  razon_social: string;
  sucursal_destino_id: string;
  sucursal: string;
  estado: 'pendiente' | 'recibida';
  comprobante: string | null;
  total: string;
  registrada_en: Date;
  recibida_en: Date | null;
}

interface PurchaseItemRow {
  id: string;
  compra_id: string;
  producto_id: string;
  nombre: string;
  cantidad: string;
  costo_unitario: string;
  subtotal: string;
  cantidad_recibida: string | null;
  diferencia: string | null;
}

const PURCHASE_SELECT = `
  SELECT c.id, c.tenant_id, c.proveedor_id, p.razon_social, c.sucursal_destino_id,
         s.nombre AS sucursal, c.estado, c.comprobante, c.total, c.registrada_en, c.recibida_en
    FROM compra c
    JOIN proveedor p ON p.id = c.proveedor_id
    JOIN sucursal s ON s.id = c.sucursal_destino_id`;

export class PgPurchaseRepository implements PurchaseRepository {
  constructor(private readonly db: PgDatabase) {}

  async insert(p: NewPurchase, by: string, at: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO compra (id, tenant_id, proveedor_id, sucursal_destino_id, estado, comprobante,
         total, registrada_por, registrada_en)
       VALUES ($1, $2, $3, $4, 'pendiente', $5, $6, $7, $8)`,
      [p.id, p.tenantId, p.supplierId, p.branchId, p.invoice, p.total, by, at],
    );
    for (const line of p.lines) {
      await this.db.query(
        `INSERT INTO compra_item (id, tenant_id, compra_id, producto_id, cantidad, costo_unitario,
           subtotal)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          line.itemId,
          p.tenantId,
          p.id,
          line.productId,
          line.quantity,
          line.unitCost,
          line.subtotal,
        ],
      );
    }
  }

  async find(tenantId: string, id: string, lock = false): Promise<Purchase | undefined> {
    const result = await this.db.query<PurchaseRow>(
      `${PURCHASE_SELECT} WHERE c.tenant_id = $1 AND c.id = $2${lock ? ' FOR UPDATE OF c' : ''}`,
      [tenantId, id],
    );
    return (await this.withItems(tenantId, result.rows))[0];
  }

  async list(
    tenantId: string,
    filter: { supplierId?: string; branchIds?: readonly string[]; pendingOnly?: boolean },
    limit: number,
  ): Promise<Purchase[]> {
    const result = await this.db.query<PurchaseRow>(
      `${PURCHASE_SELECT}
        WHERE c.tenant_id = $1
          AND ($2::uuid IS NULL OR c.proveedor_id = $2)
          AND ($3::uuid[] IS NULL OR c.sucursal_destino_id = ANY($3::uuid[]))
          AND (NOT $4 OR c.estado = 'pendiente')
        ORDER BY c.registrada_en DESC, c.id
        LIMIT $5`,
      [
        tenantId,
        filter.supplierId ?? null,
        filter.branchIds ?? null,
        filter.pendingOnly ?? false,
        limit,
      ],
    );
    return this.withItems(tenantId, result.rows);
  }

  async markReceived(
    tenantId: string,
    id: string,
    lines: readonly ReceivedLine[],
    by: string,
    at: Date,
  ): Promise<void> {
    await this.db.query(
      `UPDATE compra SET estado = 'recibida', recibida_por = $3, recibida_en = $4
        WHERE tenant_id = $1 AND id = $2 AND estado = 'pendiente'`,
      [tenantId, id, by, at],
    );
    for (const line of lines) {
      await this.db.query(
        `INSERT INTO recepcion_compra_item (id, tenant_id, compra_item_id, cantidad_recibida,
           diferencia)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), tenantId, line.itemId, line.received, line.difference],
      );
    }
  }

  async pendingForProduct(tenantId: string, productId: string): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(DISTINCT c.id)::int AS total
         FROM compra c JOIN compra_item i ON i.compra_id = c.id
        WHERE c.tenant_id = $1 AND c.estado = 'pendiente' AND i.producto_id = $2`,
      [tenantId, productId],
    );
    return result.rows[0]?.total ?? 0;
  }

  private async withItems(tenantId: string, rows: PurchaseRow[]): Promise<Purchase[]> {
    if (rows.length === 0) return [];
    const items = await this.db.query<PurchaseItemRow>(
      `SELECT i.id, i.compra_id, i.producto_id, p.nombre, i.cantidad, i.costo_unitario, i.subtotal,
              r.cantidad_recibida, r.diferencia
         FROM compra_item i
         JOIN producto p ON p.id = i.producto_id
         LEFT JOIN recepcion_compra_item r ON r.compra_item_id = i.id
        WHERE i.tenant_id = $1 AND i.compra_id = ANY($2::uuid[])
        ORDER BY p.nombre`,
      [tenantId, rows.map((row) => row.id)],
    );
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      supplierId: row.proveedor_id,
      supplierName: row.razon_social,
      branchId: row.sucursal_destino_id,
      branchName: row.sucursal,
      state: row.estado,
      invoice: row.comprobante,
      total: row.total,
      registeredAt: row.registrada_en,
      receivedAt: row.recibida_en,
      items: items.rows
        .filter((item) => item.compra_id === row.id)
        .map((item) => ({
          itemId: item.id,
          productId: item.producto_id,
          productName: item.nombre,
          quantity: item.cantidad,
          unitCost: item.costo_unitario,
          subtotal: item.subtotal,
          received: item.cantidad_recibida,
          difference: item.diferencia,
        })),
    }));
  }
}

export class PgPaymentRepository implements PaymentRepository {
  constructor(private readonly db: PgDatabase) {}

  async insert(p: Payment): Promise<void> {
    await this.db.query(
      `INSERT INTO pago_proveedor (id, tenant_id, proveedor_id, monto, metodo, comprobante_ref,
         confirmado_exceso, usuario_id, momento)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        p.id,
        p.tenantId,
        p.supplierId,
        p.amount,
        p.method,
        p.reference,
        p.confirmedExcess,
        p.userId,
        p.at,
      ],
    );
  }
}

export class PgSupplierBranches implements BranchDirectory {
  constructor(private readonly db: PgDatabase) {}

  async find(
    tenantId: string,
    branchId: string,
  ): Promise<{ id: string; name: string } | undefined> {
    const result = await this.db.query<{ id: string; nombre: string }>(
      'SELECT id, nombre FROM sucursal WHERE tenant_id = $1 AND id = $2 AND is_active',
      [tenantId, branchId],
    );
    const row = result.rows[0];
    return row ? { id: row.id, name: row.nombre } : undefined;
  }
}
