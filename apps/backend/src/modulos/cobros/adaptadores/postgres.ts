// Repositorios PostgreSQL de clientes y cobros. Tablas aisladas por comercio: se usan dentro de una
// unidad de trabajo con el comercio fijado, y además cada consulta filtra por comercio.
import { randomUUID } from 'node:crypto';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type { FiscalCondition } from '../dominio/customers.js';
import type { PaymentMethod, RefundAlerts } from '../aplicacion/gateway.js';
import type {
  Actor,
  Collection,
  CollectionMethods,
  CollectionPayment,
  CollectionRepository,
  CollectionState,
  Customer,
  CustomerRepository,
  ReceiptRecord,
} from '../aplicacion/ports.js';

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';

interface CustomerRow {
  id: string;
  tenant_id: string;
  razon_social: string;
  documento: string | null;
  condicion_fiscal: FiscalCondition;
  tiene_cuenta_corriente: boolean;
  limite_credito: string;
  saldo: string;
  comprometido: string;
  is_active: boolean;
}

const CUSTOMER_COLUMNS = `id, tenant_id, razon_social, documento, condicion_fiscal,
  tiene_cuenta_corriente, limite_credito, saldo, comprometido, is_active`;

const toCustomer = (row: CustomerRow): Customer => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.razon_social,
  document: row.documento,
  fiscalCondition: row.condicion_fiscal,
  hasAccount: row.tiene_cuenta_corriente,
  creditLimit: row.limite_credito,
  balance: row.saldo,
  committed: row.comprometido,
  isActive: row.is_active,
});

export class PgCustomerRepository implements CustomerRepository {
  constructor(private readonly db: PgDatabase) {}

  async list(tenantId: string, includeInactive: boolean): Promise<Customer[]> {
    const result = await this.db.query<CustomerRow>(
      `SELECT ${CUSTOMER_COLUMNS} FROM cliente
        WHERE tenant_id = $1 AND ($2 OR is_active) ORDER BY razon_social, id`,
      [tenantId, includeInactive],
    );
    return result.rows.map(toCustomer);
  }

  async search(tenantId: string, query: string): Promise<Customer[]> {
    const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const result = await this.db.query<CustomerRow>(
      `SELECT ${CUSTOMER_COLUMNS} FROM cliente
        WHERE tenant_id = $1 AND is_active AND (documento = $2 OR razon_social ILIKE $3)
        ORDER BY razon_social, id LIMIT 30`,
      [tenantId, query, pattern],
    );
    return result.rows.map(toCustomer);
  }

  async find(tenantId: string, id: string, lock: boolean): Promise<Customer | undefined> {
    const result = await this.db.query<CustomerRow>(
      `SELECT ${CUSTOMER_COLUMNS} FROM cliente
        WHERE tenant_id = $1 AND id = $2${lock ? ' FOR UPDATE' : ''}`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toCustomer(row) : undefined;
  }

  // El índice de documento único decide: el SAVEPOINT conserva la transacción si choca.
  private async guarded(work: () => Promise<unknown>): Promise<boolean> {
    await this.db.query('SAVEPOINT cliente_documento');
    try {
      await work();
      await this.db.query('RELEASE SAVEPOINT cliente_documento');
      return true;
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error;
      await this.db.query('ROLLBACK TO SAVEPOINT cliente_documento');
      return false;
    }
  }

  insert(c: Customer, at: Date): Promise<boolean> {
    return this.guarded(() =>
      this.db.query(
        `INSERT INTO cliente (id, tenant_id, razon_social, documento, condicion_fiscal, creado_en)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [c.id, c.tenantId, c.name, c.document, c.fiscalCondition, at],
      ),
    );
  }

  update(c: Customer): Promise<boolean> {
    return this.guarded(() =>
      this.db.query(
        `UPDATE cliente SET razon_social = $3, documento = $4, condicion_fiscal = $5,
           tiene_cuenta_corriente = $6, limite_credito = $7, version = version + 1
          WHERE tenant_id = $1 AND id = $2`,
        [c.tenantId, c.id, c.name, c.document, c.fiscalCondition, c.hasAccount, c.creditLimit],
      ),
    );
  }

  async deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE cliente SET is_active = false, desactivado_en = $3, desactivado_por = $4,
         version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND is_active`,
      [tenantId, id, at, by],
    );
  }

  async increaseBalance(
    tenantId: string,
    id: string,
    amount: string,
    allowExcess: boolean,
  ): Promise<string | null> {
    const result = await this.db.query<{ saldo: string }>(
      `UPDATE cliente SET saldo = saldo + $3, version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND ($4 OR saldo + $3 <= limite_credito)
        RETURNING saldo`,
      [tenantId, id, amount, allowExcess],
    );
    return result.rows[0]?.saldo ?? null;
  }

  async reduceBalance(tenantId: string, id: string, amount: string): Promise<string | null> {
    const result = await this.db.query<{ saldo: string }>(
      `UPDATE cliente SET saldo = saldo - $3, version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND saldo - comprometido >= $3
        RETURNING saldo`,
      [tenantId, id, amount],
    );
    return result.rows[0]?.saldo ?? null;
  }

  async commit(tenantId: string, id: string, amount: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE cliente SET comprometido = comprometido + $3
        WHERE tenant_id = $1 AND id = $2 AND saldo - comprometido >= $3`,
      [tenantId, id, amount],
    );
    return result.rowCount === 1;
  }

  async release(tenantId: string, id: string, amount: string): Promise<void> {
    await this.db.query(
      'UPDATE cliente SET comprometido = comprometido - $3 WHERE tenant_id = $1 AND id = $2',
      [tenantId, id, amount],
    );
  }

  async addMovement(
    actor: Actor,
    m: Parameters<CustomerRepository['addMovement']>[1],
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO movimiento_cuenta_corriente (id, tenant_id, cliente_id, tipo, monto,
         saldo_resultante, venta_id, cobro_id, registrado_por, registrado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        m.id,
        actor.tenantId,
        m.customerId,
        m.type,
        m.amount,
        m.balance,
        m.saleId,
        m.collectionId,
        actor.userId,
        actor.at,
      ],
    );
  }
}

interface CollectionRow {
  id: string;
  tenant_id: string;
  cliente_id: string;
  razon_social: string;
  sucursal_id: string;
  turno_id: string;
  vendedor_id: string;
  monto: string;
  estado: CollectionState;
  creado_en: Date;
}

const COLLECTION_SELECT = `SELECT c.id, c.tenant_id, c.cliente_id, k.razon_social, c.sucursal_id,
    c.turno_id, c.vendedor_id, c.monto, c.estado, c.creado_en
  FROM cobro_cuenta_corriente c JOIN cliente k ON k.id = c.cliente_id`;

const toCollection = (row: CollectionRow): Collection => ({
  id: row.id,
  tenantId: row.tenant_id,
  customerId: row.cliente_id,
  customerName: row.razon_social,
  branchId: row.sucursal_id,
  shiftId: row.turno_id,
  sellerId: row.vendedor_id,
  amount: row.monto,
  state: row.estado,
  createdAt: row.creado_en,
});

interface PaymentRow {
  id: string;
  cobro_id: string;
  metodo_pago_id: string;
  metodo: string;
  tipo: 'efectivo' | 'electronico';
  fraccion: string;
  recargo: string;
  monto_abonado: string;
  vuelto: string;
  estado: CollectionPayment['state'];
  clave_idempotencia: string | null;
  referencia_pasarela: string | null;
  verificaciones: number;
  resuelto_a_mano: boolean;
  aprobado_tarde_en: Date | null;
  autorizacion_id: string | null;
  registrado_en: Date;
}

const PAYMENT_SELECT = `SELECT p.id, p.cobro_id, p.metodo_pago_id, m.nombre AS metodo, p.tipo,
    p.fraccion, p.recargo, p.monto_abonado, p.vuelto, p.estado, p.clave_idempotencia,
    p.referencia_pasarela, p.verificaciones, p.resuelto_a_mano, p.aprobado_tarde_en,
    p.autorizacion_id, p.registrado_en
  FROM pago p JOIN metodo_pago m ON m.id = p.metodo_pago_id`;

const toPayment = (row: PaymentRow): CollectionPayment => ({
  id: row.id,
  collectionId: row.cobro_id,
  methodId: row.metodo_pago_id,
  methodName: row.metodo,
  type: row.tipo,
  amount: row.fraccion,
  adjustment: row.recargo,
  tendered: row.monto_abonado,
  change: row.vuelto,
  state: row.estado,
  key: row.clave_idempotencia,
  reference: row.referencia_pasarela,
  checks: row.verificaciones,
  manuallyResolved: row.resuelto_a_mano,
  lateApprovedAt: row.aprobado_tarde_en,
  authorizationId: row.autorizacion_id,
  at: row.registrado_en,
});

interface ReceiptRow {
  id: string;
  numero: string;
  cobro_id: string;
  cliente_id: string;
  turno_id: string;
  monto: string;
  emitido_en: Date;
}

const toReceipt = (row: ReceiptRow): ReceiptRecord => ({
  id: row.id,
  number: Number(row.numero),
  collectionId: row.cobro_id,
  customerId: row.cliente_id,
  shiftId: row.turno_id,
  amount: row.monto,
  issuedAt: row.emitido_en,
});

const PENDING = `c.estado IN ('pendiente', 'por_verificar')`;

export class PgCollectionRepository implements CollectionRepository {
  constructor(private readonly db: PgDatabase) {}

  async insert(c: Collection): Promise<void> {
    await this.db.query(
      `INSERT INTO cobro_cuenta_corriente (id, tenant_id, cliente_id, sucursal_id, turno_id,
         vendedor_id, monto, estado, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        c.id,
        c.tenantId,
        c.customerId,
        c.branchId,
        c.shiftId,
        c.sellerId,
        c.amount,
        c.state,
        c.createdAt,
      ],
    );
  }

  async find(tenantId: string, id: string, lock: boolean): Promise<Collection | undefined> {
    const result = await this.db.query<CollectionRow>(
      `${COLLECTION_SELECT} WHERE c.tenant_id = $1 AND c.id = $2${lock ? ' FOR UPDATE OF c' : ''}`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toCollection(row) : undefined;
  }

  async setState(tenantId: string, id: string, state: CollectionState, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE cobro_cuenta_corriente SET estado = $3,
         resuelto_en = CASE WHEN $3 IN ('aplicado', 'rechazado') THEN $4::timestamptz END
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, state, at],
    );
  }

  async pendingOfSeller(tenantId: string, sellerId: string): Promise<Collection[]> {
    const result = await this.db.query<CollectionRow>(
      `${COLLECTION_SELECT} WHERE c.tenant_id = $1 AND c.vendedor_id = $2 AND ${PENDING}
        ORDER BY c.creado_en`,
      [tenantId, sellerId],
    );
    return result.rows.map(toCollection);
  }

  async pendingOfShift(tenantId: string, shiftId: string): Promise<Collection[]> {
    const result = await this.db.query<CollectionRow>(
      `${COLLECTION_SELECT} WHERE c.tenant_id = $1 AND c.turno_id = $2 AND ${PENDING}
        ORDER BY c.creado_en`,
      [tenantId, shiftId],
    );
    return result.rows.map(toCollection);
  }

  async addPayment(tenantId: string, p: CollectionPayment): Promise<void> {
    await this.db.query(
      `INSERT INTO pago (id, tenant_id, cobro_id, metodo_pago_id, tipo, fraccion, recargo,
         monto_abonado, vuelto, estado, clave_idempotencia, registrado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        p.id,
        tenantId,
        p.collectionId,
        p.methodId,
        p.type,
        p.amount,
        p.adjustment,
        p.tendered,
        p.change,
        p.state,
        p.key,
        p.at,
      ],
    );
  }

  private async onePayment(where: string, params: unknown[]) {
    const result = await this.db.query<PaymentRow>(`${PAYMENT_SELECT} WHERE ${where}`, params);
    const row = result.rows[0];
    return row ? toPayment(row) : undefined;
  }

  paymentOf(tenantId: string, collectionId: string) {
    return this.onePayment('p.tenant_id = $1 AND p.cobro_id = $2', [tenantId, collectionId]);
  }

  paymentByKey(tenantId: string, key: string) {
    return this.onePayment(
      'p.tenant_id = $1 AND p.clave_idempotencia = $2 AND p.cobro_id IS NOT NULL',
      [tenantId, key],
    );
  }

  paymentById(tenantId: string, id: string) {
    return this.onePayment('p.tenant_id = $1 AND p.id = $2 AND p.cobro_id IS NOT NULL', [
      tenantId,
      id,
    ]);
  }

  async savePayment(tenantId: string, p: CollectionPayment): Promise<void> {
    await this.db.query(
      `UPDATE pago SET estado = $3, referencia_pasarela = $4, verificaciones = $5,
         resuelto_a_mano = $6, aprobado_tarde_en = $7, autorizacion_id = $8
        WHERE tenant_id = $1 AND id = $2`,
      [
        tenantId,
        p.id,
        p.state,
        p.reference,
        p.checks,
        p.manuallyResolved,
        p.lateApprovedAt,
        p.authorizationId,
      ],
    );
  }

  // Correlativo por comercio: la fila del numerador queda bloqueada hasta el commit.
  async addReceipt(tenantId: string, r: Omit<ReceiptRecord, 'number'>): Promise<ReceiptRecord> {
    const numbered = await this.db.query<{ ultimo: string }>(
      `INSERT INTO numerador_recibo (tenant_id, ultimo) VALUES ($1, 1)
       ON CONFLICT (tenant_id) DO UPDATE SET ultimo = numerador_recibo.ultimo + 1
       RETURNING ultimo`,
      [tenantId],
    );
    const number = Number(numbered.rows[0]?.ultimo);
    await this.db.query(
      `INSERT INTO recibo (id, tenant_id, numero, cobro_id, cliente_id, turno_id, monto, emitido_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [r.id, tenantId, number, r.collectionId, r.customerId, r.shiftId, r.amount, r.issuedAt],
    );
    return { ...r, number };
  }

  async receiptOf(tenantId: string, collectionId: string): Promise<ReceiptRecord | undefined> {
    const result = await this.db.query<ReceiptRow>(
      `SELECT id, numero, cobro_id, cliente_id, turno_id, monto, emitido_en
         FROM recibo WHERE tenant_id = $1 AND cobro_id = $2`,
      [tenantId, collectionId],
    );
    const row = result.rows[0];
    return row ? toReceipt(row) : undefined;
  }
}

// Medios de pago activos del comercio, sin modificarlos.
export class PgPaymentMethods implements CollectionMethods {
  constructor(private readonly db: PgDatabase) {}

  async active(tenantId: string): Promise<PaymentMethod[]> {
    const result = await this.db.query<{
      id: string;
      nombre: string;
      tipo: PaymentMethod['type'];
      recargo_pct: string;
    }>(
      `SELECT id, nombre, tipo, recargo_pct FROM metodo_pago
        WHERE tenant_id = $1 AND is_active ORDER BY creado_en, id`,
      [tenantId],
    );
    return result.rows.map((r) => ({
      id: r.id,
      name: r.nombre,
      type: r.tipo,
      adjustmentPct: r.recargo_pct,
    }));
  }
}

// Reintegro pendiente en la tabla común de alertas, para el AS y el AC (RF-127, plan §3.13).
export class PgRefundAlerts implements RefundAlerts {
  constructor(private readonly db: PgDatabase) {}

  async add(input: Parameters<RefundAlerts['add']>[0]): Promise<void> {
    for (const role of ['AS', 'AC']) {
      await this.db.query(
        `INSERT INTO alerta (id, tenant_id, sucursal_id, destinatario_rol, tipo, severidad,
           persistente, referencia, detalle, creada_en)
         VALUES ($1, $2, $3, $4, 'reintegro_pendiente', 'critica', true, $5, $6, $7)`,
        [
          randomUUID(),
          input.tenantId,
          input.branchId,
          role,
          input.paymentId,
          input.detail,
          input.at,
        ],
      );
    }
  }
}
