// Repositorios PostgreSQL de ventas. Tablas aisladas por comercio: se usan dentro de una unidad de
// trabajo con el comercio fijado, y además cada consulta filtra por comercio. El catálogo, el
// stock, los parámetros y los métodos de pago se leen sin modificarlos.
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type { PaymentMethod } from '../../cobros/aplicacion/gateway.js';
import type { IssuerCondition } from '../../fiscal/aplicacion/fiscal.js';
import type {
  BillingPolicy,
  CommercialState,
  DiscardReason,
  DiscountType,
} from '../dominio/sales.js';
import type {
  CatalogEntry,
  Payment,
  Sale,
  SaleComponent,
  SaleItem,
  SalesCatalog,
  SaleSettings,
  SalesRepository,
  SearchResult,
  Transfer,
} from '../aplicacion/ports.js';

interface SaleRow {
  id: string;
  tenant_id: string;
  sucursal_id: string;
  caja_id: string;
  turno_id: string;
  vendedor_id: string;
  numero_ticket: number | null;
  estado_comercial: CommercialState;
  estado_cobro: Sale['paymentState'];
  estado_fiscal: Sale['fiscalState'];
  se_factura: boolean | null;
  subtotal: string;
  descuento_promos: string;
  descuento_manual: string;
  total: string;
  descuento_tipo: DiscountType | null;
  descuento_valor: string | null;
  descuento_autorizacion_id: string | null;
  creada_en: Date;
  ultima_actividad: Date;
  confirmada_en: Date | null;
  motivo_descarte: DiscardReason | null;
  cliente_id: string | null;
  credito_autorizacion_id: string | null;
}

const SALE_COLUMNS = `id, tenant_id, sucursal_id, caja_id, turno_id, vendedor_id, numero_ticket,
  estado_comercial, estado_cobro, estado_fiscal, se_factura, subtotal, descuento_promos,
  descuento_manual, total, descuento_tipo, descuento_valor, descuento_autorizacion_id, creada_en,
  ultima_actividad, confirmada_en, motivo_descarte, cliente_id, credito_autorizacion_id`;

const IN_PROGRESS = `estado_comercial IN ('en_curso', 'pago_por_verificar')`;

// El valor del descuento vuelve con la escala de su tipo (porcentaje 4, monto 2).
const discountValue = (type: DiscountType, value: string) =>
  type === 'monto' ? Number(value).toFixed(2) : Number(value).toFixed(4);

const toSale = (row: SaleRow): Sale => ({
  id: row.id,
  tenantId: row.tenant_id,
  branchId: row.sucursal_id,
  registerId: row.caja_id,
  shiftId: row.turno_id,
  sellerId: row.vendedor_id,
  ticket: row.numero_ticket,
  state: row.estado_comercial,
  paymentState: row.estado_cobro,
  fiscalState: row.estado_fiscal,
  billed: row.se_factura,
  subtotal: row.subtotal,
  promoDiscount: row.descuento_promos,
  manualDiscount: row.descuento_manual,
  total: row.total,
  discount:
    row.descuento_tipo && row.descuento_valor !== null
      ? { type: row.descuento_tipo, value: discountValue(row.descuento_tipo, row.descuento_valor) }
      : null,
  discountAuthorizationId: row.descuento_autorizacion_id,
  createdAt: row.creada_en,
  lastActivity: row.ultima_actividad,
  confirmedAt: row.confirmada_en,
  discardReason: row.motivo_descarte,
  customerId: row.cliente_id,
  creditAuthorizationId: row.credito_autorizacion_id,
});

interface ItemRow {
  id: string;
  venta_id: string;
  producto_id: string;
  tipo: 'simple' | 'combo';
  nombre: string;
  categoria_id: string | null;
  cantidad: string;
  precio_fijado: string;
  tasa_iva: string | null;
  promocion_id: string | null;
  descuento_promo: string;
  descuento_manual: string;
  importe_final: string;
}

interface TransferRow {
  id: string;
  venta_id: string;
  emisor_id: string;
  emisor_nombre: string;
  receptor_id: string;
  receptor_nombre: string;
  estado: Transfer['state'];
  creado_en: Date;
  vence_en: Date;
}

const TRANSFER_SELECT = `SELECT t.id, t.venta_id, t.emisor_id, e.nombre AS emisor_nombre,
    t.receptor_id, r.nombre AS receptor_nombre, t.estado, t.creado_en, t.vence_en
  FROM traspaso t JOIN usuario e ON e.id = t.emisor_id JOIN usuario r ON r.id = t.receptor_id`;

const toTransfer = (row: TransferRow): Transfer => ({
  id: row.id,
  saleId: row.venta_id,
  senderId: row.emisor_id,
  senderName: row.emisor_nombre,
  receiverId: row.receptor_id,
  receiverName: row.receptor_nombre,
  state: row.estado,
  createdAt: row.creado_en,
  expiresAt: row.vence_en,
});

interface PaymentRow {
  id: string;
  venta_id: string;
  metodo_pago_id: string | null;
  metodo: string | null;
  tipo: Payment['type'];
  fraccion: string;
  recargo: string;
  monto_abonado: string;
  vuelto: string;
  estado: Payment['state'];
  clave_idempotencia: string | null;
  referencia_pasarela: string | null;
  verificaciones: number;
  resuelto_a_mano: boolean;
  aprobado_tarde_en: Date | null;
  autorizacion_id: string | null;
  registrado_en: Date;
}

const PAYMENT_SELECT = `SELECT p.id, p.venta_id, p.metodo_pago_id, m.nombre AS metodo, p.tipo,
    p.fraccion, p.recargo, p.monto_abonado, p.vuelto, p.estado, p.clave_idempotencia,
    p.referencia_pasarela, p.verificaciones, p.resuelto_a_mano, p.aprobado_tarde_en,
    p.autorizacion_id, p.registrado_en
  FROM pago p LEFT JOIN metodo_pago m ON m.id = p.metodo_pago_id`;

const toPayment = (row: PaymentRow): Payment => ({
  id: row.id,
  saleId: row.venta_id,
  methodId: row.metodo_pago_id,
  methodName: row.metodo ?? 'Efectivo',
  type: row.tipo,
  fraction: row.fraccion,
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

export class PgSalesRepository implements SalesRepository {
  constructor(private readonly db: PgDatabase) {}

  async insert(s: Sale): Promise<void> {
    await this.db.query(
      `INSERT INTO venta (id, tenant_id, sucursal_id, caja_id, turno_id, vendedor_id, creada_en,
         ultima_actividad)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [s.id, s.tenantId, s.branchId, s.registerId, s.shiftId, s.sellerId, s.createdAt],
    );
  }

  async find(tenantId: string, id: string, lock: boolean): Promise<Sale | undefined> {
    const result = await this.db.query<SaleRow>(
      `SELECT ${SALE_COLUMNS} FROM venta WHERE tenant_id = $1 AND id = $2${lock ? ' FOR UPDATE' : ''}`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toSale(row) : undefined;
  }

  private async many(where: string, params: unknown[]): Promise<Sale[]> {
    const result = await this.db.query<SaleRow>(
      `SELECT ${SALE_COLUMNS} FROM venta WHERE ${where} ORDER BY creada_en, id`,
      params,
    );
    return result.rows.map(toSale);
  }

  inProgressOfSeller(tenantId: string, sellerId: string): Promise<Sale[]> {
    return this.many(`tenant_id = $1 AND vendedor_id = $2 AND ${IN_PROGRESS}`, [
      tenantId,
      sellerId,
    ]);
  }

  inProgressOfShift(tenantId: string, shiftId: string): Promise<Sale[]> {
    return this.many(`tenant_id = $1 AND turno_id = $2 AND ${IN_PROGRESS}`, [tenantId, shiftId]);
  }

  inProgressOfRegister(tenantId: string, registerId: string): Promise<Sale[]> {
    return this.many(`tenant_id = $1 AND caja_id = $2 AND ${IN_PROGRESS}`, [tenantId, registerId]);
  }

  inProgressOfTenant(tenantId: string): Promise<Sale[]> {
    return this.many(`tenant_id = $1 AND estado_comercial = 'en_curso'`, [tenantId]);
  }

  // Ventas en curso que impiden una baja (D-42).
  async countInProgress(
    tenantId: string,
    filter: { branchId?: string; registerId?: string; userId?: string },
  ): Promise<number> {
    const result = await this.db.query<{ total: string }>(
      `SELECT count(*) AS total FROM venta
        WHERE tenant_id = $1 AND ${IN_PROGRESS}
          AND ($2::uuid IS NULL OR sucursal_id = $2)
          AND ($3::uuid IS NULL OR caja_id = $3)
          AND ($4::uuid IS NULL OR vendedor_id = $4)`,
      [tenantId, filter.branchId ?? null, filter.registerId ?? null, filter.userId ?? null],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  async save(s: Sale): Promise<void> {
    await this.db.query(
      `UPDATE venta SET vendedor_id = $3, turno_id = $4, caja_id = $5, numero_ticket = $6,
         estado_comercial = $7, estado_cobro = $8, estado_fiscal = $9, se_factura = $10,
         factura_decidida_por = CASE WHEN $10::boolean IS NULL THEN NULL ELSE $3::uuid END,
         subtotal = $11, descuento_promos = $12, descuento_manual = $13, total = $14,
         descuento_tipo = $15, descuento_valor = $16, descuento_autorizacion_id = $17,
         ultima_actividad = $18, confirmada_en = $19, motivo_descarte = $20,
         descartada_en = CASE WHEN $20::text IS NULL THEN NULL ELSE $18::timestamptz END,
         cliente_id = $21, credito_autorizacion_id = $22,
         version = version + 1
        WHERE tenant_id = $1 AND id = $2`,
      [
        s.tenantId,
        s.id,
        s.sellerId,
        s.shiftId,
        s.registerId,
        s.ticket,
        s.state,
        s.paymentState,
        s.fiscalState,
        s.billed,
        s.subtotal,
        s.promoDiscount,
        s.manualDiscount,
        s.total,
        s.discount?.type ?? null,
        s.discount?.value ?? null,
        s.discountAuthorizationId,
        s.lastActivity,
        s.confirmedAt,
        s.discardReason,
        s.customerId,
        s.creditAuthorizationId,
      ],
    );
  }

  async items(tenantId: string, saleId: string): Promise<SaleItem[]> {
    const result = await this.db.query<ItemRow>(
      `SELECT id, venta_id, producto_id, tipo, nombre, categoria_id, cantidad, precio_fijado,
              tasa_iva, promocion_id, descuento_promo, descuento_manual, importe_final
         FROM venta_item WHERE tenant_id = $1 AND venta_id = $2 AND quitado_en IS NULL
        ORDER BY agregado_en, id`,
      [tenantId, saleId],
    );
    const ids = result.rows.filter((r) => r.tipo === 'combo').map((r) => r.id);
    const components = new Map<string, SaleComponent[]>();
    if (ids.length > 0) {
      const parts = await this.db.query<{
        venta_item_id: string;
        producto_id: string;
        nombre: string;
        cantidad: string;
        precio_lista: string;
        tasa_iva: string;
      }>(
        `SELECT venta_item_id, producto_id, nombre, cantidad, precio_lista, tasa_iva
           FROM venta_item_componente WHERE tenant_id = $1 AND venta_item_id = ANY($2::uuid[])
          ORDER BY nombre, producto_id`,
        [tenantId, ids],
      );
      for (const p of parts.rows) {
        const list = components.get(p.venta_item_id) ?? [];
        list.push({
          productId: p.producto_id,
          name: p.nombre,
          quantity: p.cantidad,
          listPrice: p.precio_lista,
          vatRate: p.tasa_iva,
        });
        components.set(p.venta_item_id, list);
      }
    }
    return result.rows.map((row) => ({
      id: row.id,
      saleId: row.venta_id,
      productId: row.producto_id,
      type: row.tipo,
      name: row.nombre,
      categoryId: row.categoria_id,
      quantity: row.cantidad,
      fixedPrice: row.precio_fijado,
      vatRate: row.tasa_iva,
      promotionId: row.promocion_id,
      promoDiscount: row.descuento_promo,
      manualDiscount: row.descuento_manual,
      final: row.importe_final,
      components: components.get(row.id) ?? [],
    }));
  }

  async addItem(tenantId: string, i: SaleItem, at: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO venta_item (id, tenant_id, venta_id, producto_id, tipo, nombre, categoria_id,
         cantidad, precio_fijado, tasa_iva, agregado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        i.id,
        tenantId,
        i.saleId,
        i.productId,
        i.type,
        i.name,
        i.categoryId,
        i.quantity,
        i.fixedPrice,
        i.vatRate,
        at,
      ],
    );
    for (const c of i.components) {
      await this.db.query(
        `INSERT INTO venta_item_componente (id, tenant_id, venta_item_id, producto_id, nombre,
           cantidad, precio_lista, tasa_iva)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, i.id, c.productId, c.name, c.quantity, c.listPrice, c.vatRate],
      );
    }
  }

  async saveItem(tenantId: string, i: SaleItem): Promise<void> {
    await this.db.query(
      `UPDATE venta_item SET cantidad = $3, promocion_id = $4, descuento_promo = $5,
         descuento_manual = $6, importe_final = $7
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, i.id, i.quantity, i.promotionId, i.promoDiscount, i.manualDiscount, i.final],
    );
  }

  async removeItem(tenantId: string, itemId: string, at: Date): Promise<void> {
    await this.db.query(
      'UPDATE venta_item SET quitado_en = $3 WHERE tenant_id = $1 AND id = $2 AND quitado_en IS NULL',
      [tenantId, itemId, at],
    );
  }

  // Correlativo por comercio (D-81): la fila del numerador queda bloqueada hasta el commit, así
  // dos confirmaciones simultáneas nunca reciben el mismo número ni dejan saltos.
  async nextTicket(tenantId: string): Promise<number> {
    const result = await this.db.query<{ ultimo: number }>(
      `INSERT INTO numerador_ticket (tenant_id, ultimo) VALUES ($1, 1)
       ON CONFLICT (tenant_id) DO UPDATE SET ultimo = numerador_ticket.ultimo + 1
       RETURNING ultimo`,
      [tenantId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('No se pudo numerar la venta.');
    return row.ultimo;
  }

  async addPayment(tenantId: string, p: Payment): Promise<void> {
    await this.db.query(
      `INSERT INTO pago (id, tenant_id, venta_id, metodo_pago_id, tipo, fraccion, recargo,
         monto_abonado, vuelto, estado, clave_idempotencia, registrado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        p.id,
        tenantId,
        p.saleId,
        p.methodId,
        p.type,
        p.fraction,
        p.adjustment,
        p.tendered,
        p.change,
        p.state,
        p.key,
        p.at,
      ],
    );
  }

  async savePayment(tenantId: string, p: Payment): Promise<void> {
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

  async paymentsOf(tenantId: string, saleId: string): Promise<Payment[]> {
    const result = await this.db.query<PaymentRow>(
      `${PAYMENT_SELECT} WHERE p.tenant_id = $1 AND p.venta_id = $2
        ORDER BY p.registrado_en, p.id`,
      [tenantId, saleId],
    );
    return result.rows.map(toPayment);
  }

  async findPayment(tenantId: string, id: string): Promise<Payment | undefined> {
    const result = await this.db.query<PaymentRow>(
      `${PAYMENT_SELECT} WHERE p.tenant_id = $1 AND p.id = $2 AND p.venta_id IS NOT NULL`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toPayment(row) : undefined;
  }

  async paymentByKey(tenantId: string, key: string): Promise<Payment | undefined> {
    const result = await this.db.query<PaymentRow>(
      `${PAYMENT_SELECT}
        WHERE p.tenant_id = $1 AND p.clave_idempotencia = $2 AND p.venta_id IS NOT NULL`,
      [tenantId, key],
    );
    const row = result.rows[0];
    return row ? toPayment(row) : undefined;
  }

  async hasLivePayments(tenantId: string, saleId: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT 1 FROM pago WHERE tenant_id = $1 AND venta_id = $2
          AND estado IN ('pendiente', 'aprobado', 'por_verificar', 'revirtiendo')`,
      [tenantId, saleId],
    );
    return result.rows.length > 0;
  }

  async insertTransfer(tenantId: string, t: Transfer): Promise<void> {
    await this.db.query(
      `INSERT INTO traspaso (id, tenant_id, venta_id, emisor_id, receptor_id, creado_en, vence_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [t.id, tenantId, t.saleId, t.senderId, t.receiverId, t.createdAt, t.expiresAt],
    );
  }

  async pendingTransfer(tenantId: string, saleId: string): Promise<Transfer | undefined> {
    const result = await this.db.query<TransferRow>(
      `${TRANSFER_SELECT} WHERE t.tenant_id = $1 AND t.venta_id = $2 AND t.estado = 'pendiente'`,
      [tenantId, saleId],
    );
    const row = result.rows[0];
    return row ? toTransfer(row) : undefined;
  }

  async findTransfer(tenantId: string, id: string, lock: boolean): Promise<Transfer | undefined> {
    const result = await this.db.query<TransferRow>(
      `${TRANSFER_SELECT} WHERE t.tenant_id = $1 AND t.id = $2${lock ? ' FOR UPDATE OF t' : ''}`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toTransfer(row) : undefined;
  }

  async pendingTransfersTo(tenantId: string, receiverId: string): Promise<Transfer[]> {
    const result = await this.db.query<TransferRow>(
      `${TRANSFER_SELECT} WHERE t.tenant_id = $1 AND t.receptor_id = $2 AND t.estado = 'pendiente'
        ORDER BY t.creado_en`,
      [tenantId, receiverId],
    );
    return result.rows.map(toTransfer);
  }

  async resolveTransfer(
    tenantId: string,
    id: string,
    state: 'aceptado' | 'rechazado' | 'vencido',
    at: Date,
  ): Promise<void> {
    await this.db.query(
      `UPDATE traspaso SET estado = $3, resuelto_en = $4
        WHERE tenant_id = $1 AND id = $2 AND estado = 'pendiente'`,
      [tenantId, id, state, at],
    );
  }
}

interface ProductRow {
  id: string;
  nombre: string;
  tipo: 'simple' | 'combo';
  codigo_barras: string | null;
  categoria_id: string | null;
  tasa_iva: string | null;
  precio: string | null;
  is_active: boolean;
}

// Precio: el de la lista activa de la sucursal para un producto simple, el único del combo (D-63).
const PRODUCT_SELECT = `SELECT p.id, p.nombre, p.tipo, p.codigo_barras, p.categoria_id, c.tasa_iva,
    CASE WHEN p.tipo = 'combo' THEN p.precio_combo ELSE pl.precio_final END AS precio, p.is_active
  FROM producto p
  LEFT JOIN categoria c ON c.id = p.categoria_id
  LEFT JOIN sucursal s ON s.id = $2 AND s.tenant_id = p.tenant_id
  LEFT JOIN precio_lista pl ON pl.lista_id = s.lista_precio_activa_id AND pl.producto_id = p.id`;

export class PgSalesCatalog implements SalesCatalog {
  constructor(private readonly db: PgDatabase) {}

  async product(
    tenantId: string,
    branchId: string,
    productId: string,
  ): Promise<CatalogEntry | undefined> {
    const result = await this.db.query<ProductRow>(
      `${PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.id = $3`,
      [tenantId, branchId, productId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return { ...this.entry(row), components: await this.components(tenantId, branchId, row) };
  }

  async search(tenantId: string, branchId: string, query: string): Promise<SearchResult[]> {
    // El código de barras se busca exacto; el nombre, por coincidencia parcial sin mayúsculas.
    const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const result = await this.db.query<ProductRow & { disponible: string | null }>(
      `${PRODUCT_SELECT.replace('p.is_active\n', 'p.is_active, i.disponible\n')}
        LEFT JOIN inventario i ON i.sucursal_id = $2 AND i.producto_id = p.id
        WHERE p.tenant_id = $1 AND p.is_active AND (p.codigo_barras = $3 OR p.nombre ILIKE $4)
        ORDER BY (p.codigo_barras = $3) DESC NULLS LAST, p.nombre
        LIMIT 30`,
      [tenantId, branchId, query, pattern],
    );
    const found: SearchResult[] = [];
    for (const row of result.rows) {
      const components = await this.components(tenantId, branchId, row);
      found.push({
        ...this.entry(row),
        components,
        available:
          row.tipo === 'combo'
            ? await this.comboAvailable(tenantId, branchId, components)
            : (row.disponible ?? '0.000'),
      });
    }
    return found;
  }

  async available(tenantId: string, branchId: string, productId: string): Promise<string> {
    const result = await this.db.query<{ disponible: string }>(
      'SELECT disponible FROM inventario WHERE tenant_id = $1 AND sucursal_id = $2 AND producto_id = $3',
      [tenantId, branchId, productId],
    );
    return result.rows[0]?.disponible ?? '0.000';
  }

  async branchExists(tenantId: string, branchId: string): Promise<boolean> {
    const result = await this.db.query('SELECT 1 FROM sucursal WHERE tenant_id = $1 AND id = $2', [
      tenantId,
      branchId,
    ]);
    return result.rows.length > 0;
  }

  private entry(row: ProductRow): Omit<CatalogEntry, 'components'> {
    return {
      id: row.id,
      name: row.nombre,
      type: row.tipo,
      barcode: row.codigo_barras,
      categoryId: row.categoria_id,
      vatRate: row.tasa_iva,
      price: row.precio,
      isActive: row.is_active,
    };
  }

  // Componentes de un combo con su precio de lista en la sucursal y su tasa, para el IVA (D-18).
  private async components(
    tenantId: string,
    branchId: string,
    row: ProductRow,
  ): Promise<SaleComponent[]> {
    if (row.tipo !== 'combo') return [];
    const result = await this.db.query<{
      producto_id: string;
      nombre: string;
      cantidad: string;
      precio: string | null;
      tasa_iva: string;
    }>(
      `SELECT cc.producto_id, p.nombre, cc.cantidad,
              COALESCE(pl.precio_final, 0) AS precio, c.tasa_iva
         FROM combo_componente cc
         JOIN producto p ON p.id = cc.producto_id
         JOIN categoria c ON c.id = p.categoria_id
         LEFT JOIN sucursal s ON s.id = $3 AND s.tenant_id = cc.tenant_id
         LEFT JOIN precio_lista pl ON pl.lista_id = s.lista_precio_activa_id AND pl.producto_id = p.id
        WHERE cc.tenant_id = $1 AND cc.combo_id = $2 AND cc.is_active
        ORDER BY p.nombre, p.id`,
      [tenantId, row.id, branchId],
    );
    return result.rows.map((c) => ({
      productId: c.producto_id,
      name: c.nombre,
      quantity: c.cantidad,
      listPrice: c.precio ?? '0.00',
      vatRate: c.tasa_iva,
    }));
  }

  // Disponible de un combo (RF-052): el mínimo de disponible / cantidad, redondeado hacia abajo.
  private async comboAvailable(
    tenantId: string,
    branchId: string,
    components: readonly SaleComponent[],
  ): Promise<string> {
    let units: number | null = null;
    for (const c of components) {
      const available = Number(await this.available(tenantId, branchId, c.productId));
      const fits = Math.floor(available / Number(c.quantity));
      units = units === null ? fits : Math.min(units, fits);
    }
    return (units ?? 0).toFixed(3);
  }
}

// Parámetros del comercio, módulo de facturación y métodos de pago, sin modificarlos.
export class PgSaleSettings implements SaleSettings {
  constructor(
    private readonly db: PgDatabase,
    private readonly defaults: { cartIdleMinutes: number; billingPolicy: BillingPolicy },
  ) {}

  async cartIdleMinutes(tenantId: string): Promise<number> {
    const result = await this.db.query<{ inactividad_carrito_min: number }>(
      'SELECT inactividad_carrito_min FROM parametro_comercio WHERE tenant_id = $1',
      [tenantId],
    );
    return result.rows[0]?.inactividad_carrito_min ?? this.defaults.cartIdleMinutes;
  }

  async billing(tenantId: string) {
    const result = await this.db.query<{
      modulo_facturacion: boolean;
      politica_facturacion: BillingPolicy | null;
      condicion_fiscal: IssuerCondition | null;
    }>(
      `SELECT c.modulo_facturacion, p.politica_facturacion, f.condicion_fiscal
         FROM comercio c
         LEFT JOIN parametro_comercio p ON p.tenant_id = c.id
         LEFT JOIN credencial_fiscal f ON f.tenant_id = c.id
        WHERE c.id = $1`,
      [tenantId],
    );
    const row = result.rows[0];
    return {
      module: row?.modulo_facturacion ?? false,
      policy: row?.politica_facturacion ?? this.defaults.billingPolicy,
      issuer: row?.condicion_fiscal ?? null,
    };
  }

  async methods(tenantId: string): Promise<PaymentMethod[]> {
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
