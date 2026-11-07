// Repositorio PostgreSQL de devoluciones y anulaciones. La venta, sus ítems y sus pagos se leen
// sin modificarlos: las cantidades devueltas y el estado los cambia ventas.
import { randomUUID } from 'node:crypto';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type {
  RefundRecord,
  ReturnItem,
  ReturnPayment,
  ReturnRecord,
  ReturnRepository,
  ReturnSale,
  ReturnSettings,
  UncertainRefunds,
} from '../aplicacion/ports.js';

interface SaleRow {
  id: string;
  numero_ticket: number | null;
  sucursal_id: string;
  sucursal: string;
  turno_id: string;
  estado_comercial: string;
  total: string;
  se_factura: boolean | null;
  fecha_jornada: string;
  cliente_id: string | null;
  devuelto: string;
  devoluciones: string;
}

const SALE_SELECT = `SELECT v.id, v.numero_ticket, v.sucursal_id, s.nombre AS sucursal, v.turno_id,
    v.estado_comercial, v.total, v.se_factura, to_char(j.fecha_jornada, 'YYYY-MM-DD') AS fecha_jornada,
    v.cliente_id,
    COALESCE((SELECT sum(d.valor) FROM devolucion d
               WHERE d.venta_id = v.id AND d.estado = 'confirmada'), 0) AS devuelto,
    (SELECT count(*) FROM devolucion d
      WHERE d.venta_id = v.id AND d.estado IN ('pendiente', 'confirmada')) AS devoluciones
  FROM venta v
  JOIN sucursal s ON s.id = v.sucursal_id
  JOIN turno t ON t.id = v.turno_id
  JOIN jornada j ON j.id = t.jornada_id`;

export class PgReturnRepository implements ReturnRepository {
  constructor(private readonly db: PgDatabase) {}

  private async load(where: string, params: unknown[], lock: boolean) {
    const result = await this.db.query<SaleRow>(
      `${SALE_SELECT} WHERE ${where}${lock ? ' FOR UPDATE OF v' : ''}`,
      params,
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return this.complete(params[0] as string, row);
  }

  private async complete(tenantId: string, row: SaleRow): Promise<ReturnSale> {
    const items = await this.db.query<{
      id: string;
      producto_id: string;
      nombre: string;
      tipo: 'simple' | 'combo';
      cantidad: string;
      cantidad_devuelta: string;
      importe_final: string;
    }>(
      `SELECT id, producto_id, nombre, tipo, cantidad, cantidad_devuelta, importe_final
         FROM venta_item WHERE tenant_id = $1 AND venta_id = $2 AND quitado_en IS NULL
        ORDER BY agregado_en, id`,
      [tenantId, row.id],
    );
    const parts = await this.db.query<{
      venta_item_id: string;
      producto_id: string;
      nombre: string;
      cantidad: string;
    }>(
      `SELECT c.venta_item_id, c.producto_id, c.nombre, c.cantidad
         FROM venta_item_componente c JOIN venta_item i ON i.id = c.venta_item_id
        WHERE c.tenant_id = $1 AND i.venta_id = $2 ORDER BY c.nombre`,
      [tenantId, row.id],
    );
    const payments = await this.db.query<{
      id: string;
      metodo_pago_id: string | null;
      metodo: string | null;
      tipo: ReturnPayment['type'];
      cobrado: string;
      clave_idempotencia: string | null;
    }>(
      `SELECT p.id, p.metodo_pago_id, m.nombre AS metodo, p.tipo, p.fraccion + p.recargo AS cobrado,
              p.clave_idempotencia
         FROM pago p LEFT JOIN metodo_pago m ON m.id = p.metodo_pago_id
        WHERE p.tenant_id = $1 AND p.venta_id = $2 AND p.estado = 'aprobado'
        ORDER BY p.registrado_en, p.id`,
      [tenantId, row.id],
    );
    const toItem = (i: (typeof items.rows)[number]): ReturnItem => ({
      id: i.id,
      productId: i.producto_id,
      name: i.nombre,
      type: i.tipo,
      quantity: i.cantidad,
      returned: i.cantidad_devuelta,
      final: i.importe_final,
      components: parts.rows
        .filter((c) => c.venta_item_id === i.id)
        .map((c) => ({ productId: c.producto_id, name: c.nombre, quantity: c.cantidad })),
    });
    return {
      id: row.id,
      ticket: row.numero_ticket,
      branchId: row.sucursal_id,
      branchName: row.sucursal,
      shiftId: row.turno_id,
      state: row.estado_comercial,
      total: row.total,
      billed: row.se_factura,
      journeyDate: row.fecha_jornada,
      customerId: row.cliente_id,
      items: items.rows.map(toItem),
      payments: payments.rows.map((p) => ({
        id: p.id,
        methodId: p.metodo_pago_id,
        methodName: p.metodo ?? 'Efectivo',
        type: p.tipo,
        charged: Number(p.cobrado).toFixed(2),
        key: p.clave_idempotencia,
      })),
      returnedValue: Number(row.devuelto).toFixed(2),
      hasReturns: Number(row.devoluciones) > 0,
    };
  }

  find(tenantId: string, saleId: string, lock: boolean): Promise<ReturnSale | undefined> {
    return this.load('v.tenant_id = $1 AND v.id = $2', [tenantId, saleId], lock);
  }

  findByTicket(tenantId: string, ticket: number): Promise<ReturnSale | undefined> {
    return this.load('v.tenant_id = $1 AND v.numero_ticket = $2', [tenantId, ticket], false);
  }

  async insertReturn(tenantId: string, r: ReturnRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO devolucion (id, tenant_id, venta_id, sucursal_id, turno_id, vendedor_id, valor,
         reintegro, estado, autorizacion_id, creada_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pendiente', $9, $10)`,
      [
        r.id,
        tenantId,
        r.saleId,
        r.branchId,
        r.shiftId,
        r.sellerId,
        r.value,
        r.refund,
        r.authorizationId,
        r.at,
      ],
    );
    for (const item of r.items) {
      await this.db.query(
        `INSERT INTO devolucion_item (id, tenant_id, devolucion_id, venta_item_id, producto_id,
           cantidad, importe)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [item.id, tenantId, r.id, item.saleItemId, item.productId, item.quantity, item.amount],
      );
    }
  }

  async resolveReturn(
    tenantId: string,
    id: string,
    state: 'confirmada' | 'rechazada',
    at: Date,
  ): Promise<void> {
    await this.db.query(
      'UPDATE devolucion SET estado = $3, resuelta_en = $4 WHERE tenant_id = $1 AND id = $2',
      [tenantId, id, state, at],
    );
  }

  async insertVoid(
    tenantId: string,
    v: Parameters<ReturnRepository['insertVoid']>[1],
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO anulacion (id, tenant_id, venta_id, turno_id, solicitante_id, autorizacion_id,
         reintegro, creada_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [v.id, tenantId, v.saleId, v.shiftId, v.requesterId, v.authorizationId, v.refund, v.at],
    );
  }

  async addRefund(tenantId: string, r: RefundRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO reintegro (id, tenant_id, devolucion_id, anulacion_id, pago_id, tipo, monto,
         excedente, clave, registrado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [r.id, tenantId, r.returnId, r.voidId, r.paymentId, r.type, r.amount, r.excess, r.key, r.at],
    );
  }
}

export class PgReturnSettings implements ReturnSettings {
  constructor(
    private readonly db: PgDatabase,
    private readonly defaultWindowDays: number,
  ) {}

  async returnWindowDays(tenantId: string): Promise<number> {
    const result = await this.db.query<{ plazo_devolucion_dias: number }>(
      'SELECT plazo_devolucion_dias FROM parametro_comercio WHERE tenant_id = $1',
      [tenantId],
    );
    return result.rows[0]?.plazo_devolucion_dias ?? this.defaultWindowDays;
  }

  async timeZone(tenantId: string): Promise<string> {
    const result = await this.db.query<{ zona_horaria: string }>(
      'SELECT zona_horaria FROM comercio WHERE id = $1',
      [tenantId],
    );
    const zone = result.rows[0]?.zona_horaria;
    if (!zone) throw new Error('No se encontró la zona horaria del comercio.');
    return zone;
  }

  async billingModule(tenantId: string): Promise<boolean> {
    const result = await this.db.query<{ modulo_facturacion: boolean }>(
      'SELECT modulo_facturacion FROM comercio WHERE id = $1',
      [tenantId],
    );
    return result.rows[0]?.modulo_facturacion === true;
  }
}

// Reintegro electrónico incierto: alerta al AS y al AC (plan §3.13).
export class PgUncertainRefunds implements UncertainRefunds {
  constructor(private readonly db: PgDatabase) {}

  async add(input: Parameters<UncertainRefunds['add']>[0]): Promise<void> {
    for (const role of ['AS', 'AC']) {
      await this.db.query(
        `INSERT INTO alerta (id, tenant_id, sucursal_id, destinatario_rol, tipo, severidad,
           persistente, referencia, detalle, creada_en)
         VALUES ($1, $2, $3, $4, 'reintegro_incierto', 'critica', true, $5, $6, $7)`,
        [randomUUID(), input.tenantId, input.branchId, role, input.saleId, input.detail, input.at],
      );
    }
  }
}
