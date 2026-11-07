// Consultas de solo lectura de los reportes y la auditoría comercial (plan §2.18). Siempre
// filtran por comercio (además de la seguridad a nivel de fila) y por las sucursales del ámbito.
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type { Period } from '../dominio/reports.js';
import type {
  AlertCounts,
  AuditEntry,
  AuditQuery,
  AuditReader,
  BelowMinimum,
  CashCountDifference,
  DayTotal,
  MethodTotal,
  ProductTotal,
  ReportReader,
  ReportScope,
  ReturnTotals,
  SalesTotals,
  SellerTotal,
  ShiftTotal,
  TicketDocument,
  VoidTotals,
} from '../aplicacion/ports.js';

const money = (column: string) => `COALESCE(sum(${column}), 0)::numeric(14,2)::text`;

// Ventas confirmadas (o anuladas después) cuya jornada cae en el período: brutas (D-91).
// Parámetros: $1 comercio, $2 sucursales (nulo: todas), $3 y $4 fechas de jornada.
const SALES = `
  FROM venta v
  JOIN turno t ON t.id = v.turno_id AND t.tenant_id = v.tenant_id
  JOIN jornada j ON j.id = t.jornada_id AND j.tenant_id = v.tenant_id
 WHERE v.tenant_id = $1
   AND ($2::uuid[] IS NULL OR v.sucursal_id = ANY($2::uuid[]))
   AND v.estado_comercial IN ('confirmada', 'anulada')
   AND j.fecha_jornada BETWEEN $3::date AND $4::date`;

const args = (scope: ReportScope, period: Period) => [
  scope.tenantId,
  scope.branchIds,
  period.from,
  period.to,
];

interface TicketRow {
  id: string;
  sucursal_id: string;
  estado_comercial: string;
  numero_ticket: number | null;
  confirmada_en: Date | null;
  comercio: string;
  cuit: string | null;
  sucursal: string;
  direccion: string | null;
  caja: string;
  vendedor: string;
  cliente: string | null;
  documento: string | null;
  condicion_fiscal: string | null;
  subtotal: string;
  descuento_promos: string;
  descuento_manual: string;
  total: string;
  se_factura: boolean | null;
}

export class PgReportReader implements ReportReader {
  constructor(private readonly db: PgDatabase) {}

  async timeZone(tenantId: string): Promise<string> {
    const result = await this.db.query<{ zona_horaria: string }>(
      'SELECT zona_horaria FROM comercio WHERE id = $1',
      [tenantId],
    );
    return result.rows[0]?.zona_horaria ?? 'UTC';
  }

  async fiscalModule(tenantId: string): Promise<boolean> {
    const result = await this.db.query<{ modulo_facturacion: boolean }>(
      'SELECT modulo_facturacion FROM comercio WHERE id = $1',
      [tenantId],
    );
    return result.rows[0]?.modulo_facturacion === true;
  }

  // También las dadas de baja: su historia se sigue consultando.
  async branchName(tenantId: string, branchId: string): Promise<string | null> {
    const result = await this.db.query<{ nombre: string }>(
      'SELECT nombre FROM sucursal WHERE tenant_id = $1 AND id = $2',
      [tenantId, branchId],
    );
    return result.rows[0]?.nombre ?? null;
  }

  async ticket(tenantId: string, saleId: string): Promise<TicketDocument | undefined> {
    const sale = await this.db.query<TicketRow>(
      `SELECT v.id, v.sucursal_id, v.estado_comercial, v.numero_ticket, v.confirmada_en,
              co.nombre AS comercio, co.cuit, s.nombre AS sucursal, s.direccion,
              c.nombre AS caja, u.nombre AS vendedor,
              cl.razon_social AS cliente, cl.documento, cl.condicion_fiscal,
              -- Bruto, antes de promociones: el ticket muestra el desglose completo (RF-107).
              (SELECT COALESCE(sum(round(vi.precio_fijado * vi.cantidad, 2)), 0)::numeric(14,2)
                 FROM venta_item vi
                WHERE vi.venta_id = v.id AND vi.tenant_id = v.tenant_id
                  AND vi.quitado_en IS NULL)::text AS subtotal,
              v.descuento_promos::text, v.descuento_manual::text,
              v.total::text, v.se_factura
         FROM venta v
         JOIN comercio co ON co.id = v.tenant_id
         JOIN sucursal s ON s.id = v.sucursal_id AND s.tenant_id = v.tenant_id
         JOIN caja c ON c.id = v.caja_id AND c.tenant_id = v.tenant_id
         JOIN usuario u ON u.id = v.vendedor_id
         LEFT JOIN cliente cl ON cl.id = v.cliente_id AND cl.tenant_id = v.tenant_id
        WHERE v.tenant_id = $1 AND v.id = $2`,
      [tenantId, saleId],
    );
    const row = sale.rows[0];
    if (!row) return undefined;

    const items = await this.db.query<{
      nombre: string;
      cantidad: string;
      precio_fijado: string;
      bruto: string;
      promocion: string | null;
      descuento_promo: string;
      descuento_manual: string;
      importe_final: string;
      cantidad_devuelta: string;
    }>(
      `SELECT vi.nombre, vi.cantidad::text, vi.precio_fijado::text,
              round(vi.precio_fijado * vi.cantidad, 2)::text AS bruto,
              p.nombre AS promocion, vi.descuento_promo::text, vi.descuento_manual::text,
              vi.importe_final::text, vi.cantidad_devuelta::text
         FROM venta_item vi
         LEFT JOIN promocion p ON p.id = vi.promocion_id AND p.tenant_id = vi.tenant_id
        WHERE vi.tenant_id = $1 AND vi.venta_id = $2 AND vi.quitado_en IS NULL
        ORDER BY vi.agregado_en, vi.id`,
      [tenantId, saleId],
    );
    const payments = await this.db.query<{
      metodo: string;
      tipo: string;
      fraccion: string;
      recargo: string;
      monto_abonado: string;
      vuelto: string;
    }>(
      `SELECT COALESCE(m.nombre, p.tipo) AS metodo, p.tipo, p.fraccion::text, p.recargo::text,
              p.monto_abonado::text, p.vuelto::text
         FROM pago p
         LEFT JOIN metodo_pago m ON m.id = p.metodo_pago_id AND m.tenant_id = p.tenant_id
        WHERE p.tenant_id = $1 AND p.venta_id = $2 AND p.estado = 'aprobado'
        ORDER BY p.registrado_en, p.id`,
      [tenantId, saleId],
    );
    const voucher = await this.db.query<{
      tipo: string;
      clase: string | null;
      punto_venta: number | null;
      numero: string | null;
      cae: string | null;
      caea_codigo: string | null;
      estado: string;
      no_fiscal: boolean;
    }>(
      `SELECT tipo, clase, punto_venta, numero::text, cae, caea_codigo, estado, no_fiscal
         FROM comprobante
        WHERE tenant_id = $1 AND venta_id = $2 AND tipo = 'factura'`,
      [tenantId, saleId],
    );
    const surcharges = await this.db.query<{ recargos: string; cobrado: string }>(
      `SELECT ${money('recargo')} AS recargos,
              ($3::numeric + COALESCE(sum(recargo), 0))::numeric(14,2)::text AS cobrado
         FROM pago
        WHERE tenant_id = $1 AND venta_id = $2 AND estado = 'aprobado'`,
      [tenantId, saleId, row.total],
    );
    const v = voucher.rows[0];
    const surchargeTotal = surcharges.rows[0]?.recargos ?? '0.00';
    return {
      saleId: row.id,
      branchId: row.sucursal_id,
      state: row.estado_comercial,
      ticketNumber: row.numero_ticket,
      confirmedAt: row.confirmada_en,
      tenant: { name: row.comercio, cuit: row.cuit },
      branch: { name: row.sucursal, address: row.direccion },
      register: row.caja,
      seller: row.vendedor,
      customer:
        row.cliente === null
          ? null
          : {
              name: row.cliente,
              document: row.documento,
              taxCondition: row.condicion_fiscal ?? 'consumidor_final',
            },
      items: items.rows.map((i) => ({
        name: i.nombre,
        quantity: i.cantidad,
        unitPrice: i.precio_fijado,
        gross: i.bruto,
        promotion: i.promocion === null ? null : { name: i.promocion, discount: i.descuento_promo },
        manualDiscount: i.descuento_manual,
        final: i.importe_final,
        returned: i.cantidad_devuelta,
      })),
      payments: payments.rows.map((p) => ({
        method: p.metodo,
        type: p.tipo,
        amount: p.fraccion,
        surcharge: p.recargo,
        tendered: p.monto_abonado,
        change: p.vuelto,
      })),
      totals: {
        subtotal: row.subtotal,
        promotionDiscount: row.descuento_promos,
        manualDiscount: row.descuento_manual,
        total: row.total,
        surcharges: surchargeTotal,
        charged: surcharges.rows[0]?.cobrado ?? row.total,
      },
      billed: row.se_factura === true,
      voucher: v
        ? {
            type: v.tipo,
            voucherClass: v.clase,
            pointOfSale: v.punto_venta,
            number: v.numero,
            cae: v.cae,
            caea: v.caea_codigo,
            state: v.estado,
            nonFiscal: v.no_fiscal,
          }
        : null,
    };
  }

  async sales(scope: ReportScope, period: Period): Promise<SalesTotals> {
    const result = await this.db.query<{ total: string; tickets: number }>(
      `SELECT ${money('v.total')} AS total, count(*)::int AS tickets ${SALES}`,
      args(scope, period),
    );
    return result.rows[0] ?? { total: '0.00', tickets: 0 };
  }

  async byMethod(scope: ReportScope, period: Period): Promise<MethodTotal[]> {
    const result = await this.db.query<{
      metodo: string;
      tipo: string;
      monto: string;
      recargo: string;
    }>(
      `SELECT COALESCE(m.nombre, p.tipo) AS metodo, p.tipo,
              ${money('p.fraccion')} AS monto, ${money('p.recargo')} AS recargo
         FROM pago p
         LEFT JOIN metodo_pago m ON m.id = p.metodo_pago_id AND m.tenant_id = p.tenant_id
        WHERE p.estado = 'aprobado' AND p.venta_id IN (SELECT v.id ${SALES})
        GROUP BY COALESCE(m.nombre, p.tipo), p.tipo
        ORDER BY sum(p.fraccion) DESC, metodo`,
      args(scope, period),
    );
    return result.rows.map((r) => ({
      method: r.metodo,
      type: r.tipo,
      amount: r.monto,
      surcharge: r.recargo,
    }));
  }

  async bySeller(scope: ReportScope, period: Period): Promise<SellerTotal[]> {
    const result = await this.db.query<{
      vendedor_id: string;
      vendedor: string;
      tickets: number;
      total: string;
    }>(
      `SELECT v.vendedor_id, u.nombre AS vendedor, count(*)::int AS tickets,
              ${money('v.total')} AS total
         ${SALES.replace('FROM venta v', 'FROM venta v JOIN usuario u ON u.id = v.vendedor_id')}
        GROUP BY v.vendedor_id, u.nombre
        ORDER BY sum(v.total) DESC, u.nombre`,
      args(scope, period),
    );
    return result.rows.map((r) => ({
      sellerId: r.vendedor_id,
      seller: r.vendedor,
      tickets: r.tickets,
      total: r.total,
    }));
  }

  async byShift(scope: ReportScope, period: Period): Promise<ShiftTotal[]> {
    const result = await this.db.query<{
      id: string;
      caja: string;
      vendedor: string;
      abierto_en: Date;
      cerrado_en: Date | null;
      tickets: number;
      total: string;
      resultado: string | null;
      diferencia: string | null;
    }>(
      `SELECT t.id, c.nombre AS caja, u.nombre AS vendedor, t.abierto_en, t.cerrado_en,
              count(v.id)::int AS tickets, ${money('v.total')} AS total,
              t.resultado, t.diferencia::text
         FROM turno t
         JOIN jornada j ON j.id = t.jornada_id AND j.tenant_id = t.tenant_id
         JOIN caja c ON c.id = t.caja_id AND c.tenant_id = t.tenant_id
         JOIN usuario u ON u.id = t.vendedor_id
         LEFT JOIN venta v ON v.turno_id = t.id AND v.tenant_id = t.tenant_id
                          AND v.estado_comercial IN ('confirmada', 'anulada')
        WHERE t.tenant_id = $1
          AND ($2::uuid[] IS NULL OR t.sucursal_id = ANY($2::uuid[]))
          AND j.fecha_jornada BETWEEN $3::date AND $4::date
        GROUP BY t.id, c.nombre, u.nombre
        ORDER BY t.abierto_en, t.id`,
      args(scope, period),
    );
    return result.rows.map((r) => ({
      shiftId: r.id,
      register: r.caja,
      seller: r.vendedor,
      openedAt: r.abierto_en,
      closedAt: r.cerrado_en,
      tickets: r.tickets,
      total: r.total,
      result: r.resultado,
      difference: r.diferencia,
    }));
  }

  async byProduct(scope: ReportScope, period: Period, limit: number): Promise<ProductTotal[]> {
    const result = await this.db.query<{
      producto_id: string;
      nombre: string;
      cantidad: string;
      total: string;
    }>(
      `SELECT vi.producto_id, max(vi.nombre) AS nombre,
              COALESCE(sum(vi.cantidad), 0)::numeric(12,3)::text AS cantidad,
              ${money('vi.importe_final')} AS total
         FROM venta_item vi
        WHERE vi.quitado_en IS NULL AND vi.venta_id IN (SELECT v.id ${SALES})
        GROUP BY vi.producto_id
        ORDER BY sum(vi.importe_final) DESC, max(vi.nombre)
        LIMIT $5`,
      [...args(scope, period), limit],
    );
    return result.rows.map((r) => ({
      productId: r.producto_id,
      name: r.nombre,
      quantity: r.cantidad,
      total: r.total,
    }));
  }

  async byDay(scope: ReportScope, period: Period): Promise<DayTotal[]> {
    const result = await this.db.query<{ dia: string; total: string; tickets: number }>(
      `SELECT to_char(j.fecha_jornada, 'YYYY-MM-DD') AS dia, ${money('v.total')} AS total,
              count(*)::int AS tickets
         ${SALES}
        GROUP BY j.fecha_jornada
        ORDER BY j.fecha_jornada`,
      args(scope, period),
    );
    return result.rows.map((r) => ({ day: r.dia, total: r.total, tickets: r.tickets }));
  }

  // Devoluciones confirmadas en la sucursal que las recibió, por la jornada en que se hicieron.
  async returns(scope: ReportScope, period: Period): Promise<ReturnTotals> {
    const result = await this.db.query<{ cantidad: number; valor: string; reintegro: string }>(
      `SELECT count(*)::int AS cantidad, ${money('d.valor')} AS valor,
              ${money('d.reintegro')} AS reintegro
         FROM devolucion d
         JOIN turno t ON t.id = d.turno_id AND t.tenant_id = d.tenant_id
         JOIN jornada j ON j.id = t.jornada_id AND j.tenant_id = d.tenant_id
        WHERE d.tenant_id = $1 AND d.estado = 'confirmada'
          AND ($2::uuid[] IS NULL OR d.sucursal_id = ANY($2::uuid[]))
          AND j.fecha_jornada BETWEEN $3::date AND $4::date`,
      args(scope, period),
    );
    const r = result.rows[0];
    return { count: r?.cantidad ?? 0, value: r?.valor ?? '0.00', refund: r?.reintegro ?? '0.00' };
  }

  async voids(scope: ReportScope, period: Period): Promise<VoidTotals> {
    const result = await this.db.query<{ cantidad: number; total: string; reintegro: string }>(
      `SELECT count(*)::int AS cantidad, ${money('v.total')} AS total,
              ${money('a.reintegro')} AS reintegro
         FROM anulacion a
         JOIN venta v ON v.id = a.venta_id AND v.tenant_id = a.tenant_id
         JOIN turno t ON t.id = a.turno_id AND t.tenant_id = a.tenant_id
         JOIN jornada j ON j.id = t.jornada_id AND j.tenant_id = a.tenant_id
        WHERE a.tenant_id = $1
          AND ($2::uuid[] IS NULL OR v.sucursal_id = ANY($2::uuid[]))
          AND j.fecha_jornada BETWEEN $3::date AND $4::date`,
      args(scope, period),
    );
    const r = result.rows[0];
    return { count: r?.cantidad ?? 0, total: r?.total ?? '0.00', refund: r?.reintegro ?? '0.00' };
  }

  // Cortes X de turnos y cortes Z de jornadas con faltante o sobrante.
  async cashCounts(scope: ReportScope, period: Period): Promise<CashCountDifference[]> {
    const result = await this.db.query<{
      tipo: 'turno' | 'jornada';
      caja: string;
      vendedor: string | null;
      dia: string;
      resultado: 'faltante' | 'sobrante';
      diferencia: string;
      momento: Date;
    }>(
      `SELECT * FROM (
         SELECT 'turno' AS tipo, c.nombre AS caja, u.nombre AS vendedor,
                to_char(j.fecha_jornada, 'YYYY-MM-DD') AS dia, t.resultado,
                t.diferencia::text AS diferencia, t.cerrado_en AS momento
           FROM turno t
           JOIN jornada j ON j.id = t.jornada_id AND j.tenant_id = t.tenant_id
           JOIN caja c ON c.id = t.caja_id AND c.tenant_id = t.tenant_id
           JOIN usuario u ON u.id = t.vendedor_id
          WHERE t.tenant_id = $1 AND t.estado = 'cerrado' AND t.resultado <> 'cuadrado'
            AND ($2::uuid[] IS NULL OR t.sucursal_id = ANY($2::uuid[]))
            AND j.fecha_jornada BETWEEN $3::date AND $4::date
         UNION ALL
         SELECT 'jornada', c.nombre, NULL, to_char(j.fecha_jornada, 'YYYY-MM-DD'), j.resultado_z,
                j.diferencia_z::text, j.cerrada_en
           FROM jornada j
           JOIN caja c ON c.id = j.caja_id AND c.tenant_id = j.tenant_id
          WHERE j.tenant_id = $1 AND j.estado = 'cerrada' AND j.resultado_z <> 'cuadrado'
            AND ($2::uuid[] IS NULL OR j.sucursal_id = ANY($2::uuid[]))
            AND j.fecha_jornada BETWEEN $3::date AND $4::date
       ) arqueos
       ORDER BY momento DESC
       LIMIT 100`,
      args(scope, period),
    );
    return result.rows.map((r) => ({
      kind: r.tipo,
      register: r.caja,
      seller: r.vendedor,
      day: r.dia,
      result: r.resultado,
      difference: r.diferencia,
      at: r.momento,
    }));
  }

  async pendingVouchers(scope: ReportScope, period: Period | null): Promise<number> {
    const result = await this.db.query<{ cantidad: number }>(
      `SELECT count(*)::int AS cantidad
         FROM comprobante c
        WHERE c.tenant_id = $1 AND c.estado <> 'aceptado'
          AND ($2::uuid[] IS NULL OR c.sucursal_id = ANY($2::uuid[]))
          AND ($3::date IS NULL OR c.venta_id IN (SELECT v.id ${SALES}))`,
      [scope.tenantId, scope.branchIds, period?.from ?? null, period?.to ?? null],
    );
    return result.rows[0]?.cantidad ?? 0;
  }

  async belowMinimum(scope: ReportScope): Promise<BelowMinimum[]> {
    const result = await this.db.query<{
      sucursal: string;
      producto: string;
      disponible: string;
      umbral: string;
    }>(
      `SELECT s.nombre AS sucursal, p.nombre AS producto, i.disponible::text,
              i.umbral_minimo::text AS umbral
         FROM inventario i
         JOIN producto p ON p.id = i.producto_id AND p.tenant_id = i.tenant_id
         JOIN sucursal s ON s.id = i.sucursal_id AND s.tenant_id = i.tenant_id
        WHERE i.tenant_id = $1 AND i.umbral_minimo IS NOT NULL
          AND i.disponible < i.umbral_minimo AND p.is_active AND s.is_active
          AND ($2::uuid[] IS NULL OR i.sucursal_id = ANY($2::uuid[]))
        ORDER BY s.nombre, p.nombre
        LIMIT 100`,
      [scope.tenantId, scope.branchIds],
    );
    return result.rows.map((r) => ({
      branch: r.sucursal,
      product: r.producto,
      available: r.disponible,
      minimum: r.umbral,
    }));
  }

  async alertCounts(scope: ReportScope, role: 'AC' | 'AS'): Promise<AlertCounts> {
    const result = await this.db.query<{ severidad: string; cantidad: number }>(
      `SELECT severidad, count(*)::int AS cantidad
         FROM alerta
        WHERE tenant_id = $1 AND resuelta_en IS NULL AND destinatario_rol = $3
          AND destinatario_id IS NULL
          AND ($2::uuid[] IS NULL OR sucursal_id = ANY($2::uuid[]))
        GROUP BY severidad`,
      [scope.tenantId, scope.branchIds, role],
    );
    const count = (severity: string) =>
      result.rows.find((r) => r.severidad === severity)?.cantidad ?? 0;
    return { critical: count('critica'), warning: count('advertencia'), info: count('info') };
  }
}

export class PgAuditReader implements AuditReader {
  constructor(private readonly db: PgDatabase) {}

  async entries(q: AuditQuery): Promise<AuditEntry[]> {
    const result = await this.db.query<{
      id: string;
      momento: Date;
      sucursal_id: string | null;
      sucursal: string | null;
      usuario_id: string;
      usuario: string | null;
      rol_activo: string;
      accion: string;
      entidad: string;
      entidad_id: string;
      estado_anterior: unknown;
      estado_posterior: unknown;
      autorizacion_id: string | null;
    }>(
      `SELECT a.id, a.momento, a.sucursal_id, s.nombre AS sucursal, a.usuario_id,
              u.nombre AS usuario, a.rol_activo, a.accion, a.entidad, a.entidad_id,
              a.estado_anterior, a.estado_posterior, a.autorizacion_id
         FROM auditoria_comercial a
         LEFT JOIN sucursal s ON s.id = a.sucursal_id AND s.tenant_id = a.tenant_id
         LEFT JOIN usuario u ON u.id = a.usuario_id
        WHERE a.tenant_id = $1
          AND ($2::uuid[] IS NULL OR a.sucursal_id = ANY($2::uuid[]))
          AND a.momento BETWEEN $3 AND $4
          AND ($5::uuid IS NULL OR a.usuario_id = $5)
          AND ($6::text IS NULL OR a.entidad = $6)
          AND ($7::text IS NULL OR a.accion = $7)
        ORDER BY a.momento DESC, a.id DESC
        LIMIT $8 OFFSET $9`,
      [q.tenantId, q.branchIds, q.from, q.to, q.userId, q.entity, q.action, q.limit, q.offset],
    );
    return result.rows.map((r) => ({
      id: r.id,
      at: r.momento,
      branchId: r.sucursal_id,
      branch: r.sucursal,
      userId: r.usuario_id,
      user: r.usuario,
      role: r.rol_activo,
      action: r.accion,
      entity: r.entidad,
      entityId: r.entidad_id,
      before: r.estado_anterior,
      after: r.estado_posterior,
      authorizationId: r.autorizacion_id,
    }));
  }
}
