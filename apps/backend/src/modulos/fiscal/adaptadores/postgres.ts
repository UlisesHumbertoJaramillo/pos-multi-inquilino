// Repositorios PostgreSQL del módulo fiscal. Tablas aisladas por comercio: se usan dentro de una
// unidad de trabajo con el comercio fijado, y además cada consulta filtra por comercio. La venta,
// la caja y los parámetros se leen sin modificarlos.
import { randomUUID } from 'node:crypto';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type { IssuerCondition, VoucherClass } from '../dominio/vouchers.js';
import type {
  FiscalAlert,
  FiscalAlerts,
  FiscalDirectory,
  FiscalRepository,
  FiscalSales,
  SaleForVoucher,
  Voucher,
  VoucherRow,
  VoucherState,
} from '../aplicacion/ports.js';

interface Row {
  id: string;
  tenant_id: string;
  tipo: Voucher['type'];
  clase: VoucherClass | null;
  venta_id: string;
  sucursal_id: string;
  caja_id: string;
  punto_venta: number | null;
  numero: string | null;
  total: string;
  comprador_nombre: string | null;
  comprador_documento: string | null;
  comprador_condicion: string;
  contingencia: boolean;
  caea_codigo: string | null;
  no_fiscal: boolean;
  cae: string | null;
  estado: VoucherState;
  motivo_rechazo: string | null;
  intentos: number;
  proximo_intento: Date;
  plazo_vence: Date;
  emitido_en: Date;
  resuelto_en: Date | null;
}

const COLUMNS = `c.id, c.tenant_id, c.tipo, c.clase, c.venta_id, c.sucursal_id, c.caja_id,
  c.punto_venta, c.numero, c.total, c.comprador_nombre, c.comprador_documento,
  c.comprador_condicion, c.contingencia, c.caea_codigo, c.no_fiscal, c.cae, c.estado,
  c.motivo_rechazo, c.intentos, c.proximo_intento, c.plazo_vence, c.emitido_en, c.resuelto_en`;

const toVoucher = (r: Row): Voucher => ({
  id: r.id,
  tenantId: r.tenant_id,
  type: r.tipo,
  voucherClass: r.clase,
  saleId: r.venta_id,
  branchId: r.sucursal_id,
  registerId: r.caja_id,
  pointOfSale: r.punto_venta,
  number: r.numero === null ? null : Number(r.numero),
  total: r.total,
  buyer: {
    name: r.comprador_nombre,
    document: r.comprador_documento,
    condition: r.comprador_condicion,
  },
  contingency: r.contingencia,
  caeaCode: r.caea_codigo,
  nonFiscal: r.no_fiscal,
  cae: r.cae,
  state: r.estado,
  rejection: r.motivo_rechazo,
  attempts: r.intentos,
  nextAttemptAt: r.proximo_intento,
  deadline: r.plazo_vence,
  issuedAt: r.emitido_en,
  resolvedAt: r.resuelto_en,
});

export class PgFiscalRepository implements FiscalRepository {
  constructor(private readonly db: PgDatabase) {}

  async insert(v: Voucher): Promise<void> {
    await this.db.query(
      `INSERT INTO comprobante (id, tenant_id, tipo, venta_id, sucursal_id, caja_id, punto_venta,
         total, comprador_nombre, comprador_documento, comprador_condicion, estado,
         proximo_intento, plazo_vence, emitido_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        v.id,
        v.tenantId,
        v.type,
        v.saleId,
        v.branchId,
        v.registerId,
        v.pointOfSale,
        v.total,
        v.buyer.name,
        v.buyer.document,
        v.buyer.condition,
        v.state,
        v.nextAttemptAt,
        v.deadline,
        v.issuedAt,
      ],
    );
  }

  async find(tenantId: string, id: string, lock: boolean): Promise<Voucher | undefined> {
    const result = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM comprobante c
        WHERE c.tenant_id = $1 AND c.id = $2${lock ? ' FOR UPDATE' : ''}`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toVoucher(row) : undefined;
  }

  async forSale(tenantId: string, saleId: string): Promise<Voucher | undefined> {
    const result = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM comprobante c
        WHERE c.tenant_id = $1 AND c.venta_id = $2 AND c.tipo = 'factura'`,
      [tenantId, saleId],
    );
    const row = result.rows[0];
    return row ? toVoucher(row) : undefined;
  }

  async list(tenantId: string, branchIds: readonly string[] | null): Promise<VoucherRow[]> {
    const result = await this.db.query<Row & { numero_ticket: number | null }>(
      `SELECT ${COLUMNS}, v.numero_ticket
         FROM comprobante c JOIN venta v ON v.id = c.venta_id
        WHERE c.tenant_id = $1 AND ($2::uuid[] IS NULL OR c.sucursal_id = ANY($2::uuid[]))
        ORDER BY c.emitido_en DESC, c.id LIMIT 200`,
      [tenantId, branchIds],
    );
    return result.rows.map((r) => ({ ...toVoucher(r), ticket: r.numero_ticket }));
  }

  async due(tenantId: string, now: Date): Promise<Voucher[]> {
    const result = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM comprobante c
        WHERE c.tenant_id = $1 AND c.estado = 'pendiente' AND c.proximo_intento <= $2
        ORDER BY c.punto_venta NULLS LAST, c.emitido_en, c.numero NULLS LAST, c.id`,
      [tenantId, now],
    );
    return result.rows.map(toVoucher);
  }

  async claim(tenantId: string, id: string, now: Date, until: Date): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE comprobante SET proximo_intento = $4
        WHERE tenant_id = $1 AND id = $2 AND estado = 'pendiente' AND proximo_intento <= $3`,
      [tenantId, id, now, until],
    );
    return result.rowCount === 1;
  }

  async save(v: Voucher): Promise<void> {
    await this.db.query(
      `UPDATE comprobante SET clase = $3, punto_venta = $4, numero = $5, comprador_nombre = $6,
         comprador_documento = $7, comprador_condicion = $8, contingencia = $9, caea_codigo = $10,
         no_fiscal = $11, cae = $12, estado = $13, motivo_rechazo = $14, intentos = $15,
         proximo_intento = $16, resuelto_en = $17
        WHERE tenant_id = $1 AND id = $2`,
      [
        v.tenantId,
        v.id,
        v.voucherClass,
        v.pointOfSale,
        v.number,
        v.buyer.name,
        v.buyer.document,
        v.buyer.condition,
        v.contingency,
        v.caeaCode,
        v.nonFiscal,
        v.cae,
        v.state,
        v.rejection,
        v.attempts,
        v.nextAttemptAt,
        v.resolvedAt,
      ],
    );
  }

  async nextNumber(
    tenantId: string,
    pointOfSale: number,
    voucherClass: VoucherClass,
  ): Promise<number> {
    const result = await this.db.query<{ ultimo: string }>(
      `INSERT INTO numerador_comprobante (tenant_id, punto_venta, clase, ultimo)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (tenant_id, punto_venta, clase)
       DO UPDATE SET ultimo = numerador_comprobante.ultimo + 1
       RETURNING ultimo`,
      [tenantId, pointOfSale, voucherClass],
    );
    return Number(result.rows[0]?.ultimo);
  }

  async addAttempt(
    tenantId: string,
    a: Parameters<FiscalRepository['addAttempt']>[1],
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO intento_envio_fiscal (id, tenant_id, comprobante_id, momento, resultado, respuesta)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [a.id, tenantId, a.voucherId, a.at, a.result, a.detail],
    );
  }

  async overdue(tenantId: string, now: Date): Promise<Voucher[]> {
    const result = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM comprobante c
        WHERE c.tenant_id = $1 AND c.estado IN ('pendiente', 'rechazado') AND c.plazo_vence <= $2`,
      [tenantId, now],
    );
    return result.rows.map(toVoucher);
  }

  async pendingCounts(tenantId: string) {
    const result = await this.db.query<{ queued: string; rejected: string; caea: string }>(
      `SELECT count(*) FILTER (WHERE estado = 'pendiente' AND NOT contingencia) AS queued,
              count(*) FILTER (WHERE estado = 'rechazado') AS rejected,
              count(*) FILTER (WHERE estado = 'pendiente' AND contingencia) AS caea
         FROM comprobante WHERE tenant_id = $1`,
      [tenantId],
    );
    const row = result.rows[0];
    return {
      queued: Number(row?.queued ?? 0),
      rejected: Number(row?.rejected ?? 0),
      caeaNotReported: Number(row?.caea ?? 0),
    };
  }

  async credentialInfo(tenantId: string) {
    const result = await this.db.query<{
      cuit: string;
      condicion_fiscal: IssuerCondition;
      vence_en: Date;
    }>('SELECT cuit, condicion_fiscal, vence_en FROM credencial_fiscal WHERE tenant_id = $1', [
      tenantId,
    ]);
    const row = result.rows[0];
    return row && { cuit: row.cuit, condition: row.condicion_fiscal, expiresAt: row.vence_en };
  }

  async saveCredential(
    tenantId: string,
    c: Parameters<FiscalRepository['saveCredential']>[1],
    by: string,
    at: Date,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO credencial_fiscal (tenant_id, cuit, condicion_fiscal, certificado_cifrado,
         clave_cifrada, vence_en, cargado_por, cargado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id) DO UPDATE SET cuit = EXCLUDED.cuit,
         condicion_fiscal = EXCLUDED.condicion_fiscal,
         certificado_cifrado = EXCLUDED.certificado_cifrado, clave_cifrada = EXCLUDED.clave_cifrada,
         vence_en = EXCLUDED.vence_en, cargado_por = EXCLUDED.cargado_por,
         cargado_en = EXCLUDED.cargado_en`,
      [tenantId, c.cuit, c.condition, c.certificate, c.key, c.expiresAt, by, at],
    );
  }

  async caeaFor(tenantId: string, date: string): Promise<string | undefined> {
    const result = await this.db.query<{ codigo: string }>(
      `SELECT codigo FROM caea
        WHERE tenant_id = $1 AND vigente_desde <= $2::date AND vigente_hasta >= $2::date`,
      [tenantId, date],
    );
    return result.rows[0]?.codigo;
  }

  async hasCaea(tenantId: string, period: string): Promise<boolean> {
    const result = await this.db.query('SELECT 1 FROM caea WHERE tenant_id = $1 AND periodo = $2', [
      tenantId,
      period,
    ]);
    return result.rows.length > 0;
  }

  async addCaea(tenantId: string, c: Parameters<FiscalRepository['addCaea']>[1]): Promise<void> {
    await this.db.query(
      `INSERT INTO caea (id, tenant_id, periodo, codigo, vigente_desde, vigente_hasta, obtenido_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tenant_id, periodo) DO NOTHING`,
      [c.id, tenantId, c.period, c.code, c.from, c.to, c.at],
    );
  }
}

export class PgFiscalDirectory implements FiscalDirectory {
  constructor(
    private readonly db: PgDatabase,
    private readonly defaults: { regularizationHours: number; laterInvoicingDays: number },
  ) {}

  async tenantsWithModule(): Promise<string[]> {
    const result = await this.db.query<{ id: string }>(
      'SELECT id FROM comercio WHERE modulo_facturacion ORDER BY id',
    );
    return result.rows.map((r) => r.id);
  }

  async moduleActive(tenantId: string): Promise<boolean> {
    const result = await this.db.query<{ modulo_facturacion: boolean }>(
      'SELECT modulo_facturacion FROM comercio WHERE id = $1',
      [tenantId],
    );
    return result.rows[0]?.modulo_facturacion === true;
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

  async settings(tenantId: string) {
    const result = await this.db.query<{
      plazo_regularizacion_horas: number;
      plazo_facturacion_posterior_dias: number;
    }>(
      `SELECT plazo_regularizacion_horas, plazo_facturacion_posterior_dias
         FROM parametro_comercio WHERE tenant_id = $1`,
      [tenantId],
    );
    const row = result.rows[0];
    return {
      regularizationHours: row?.plazo_regularizacion_horas ?? this.defaults.regularizationHours,
      laterInvoicingDays: row?.plazo_facturacion_posterior_dias ?? this.defaults.laterInvoicingDays,
    };
  }
}

interface SaleRow {
  id: string;
  sucursal_id: string;
  caja_id: string;
  total: string;
  estado_comercial: string;
  se_factura: boolean | null;
  fecha_jornada: string;
  razon_social: string | null;
  documento: string | null;
  condicion_fiscal: string | null;
  punto_venta_fiscal: number | null;
}

const SALE_SELECT = `SELECT v.id, v.sucursal_id, v.caja_id, v.total, v.estado_comercial,
    v.se_factura, to_char(j.fecha_jornada, 'YYYY-MM-DD') AS fecha_jornada, k.razon_social,
    k.documento, k.condicion_fiscal, c.punto_venta_fiscal
  FROM venta v
  JOIN turno t ON t.id = v.turno_id
  JOIN jornada j ON j.id = t.jornada_id
  JOIN caja c ON c.id = v.caja_id
  LEFT JOIN cliente k ON k.id = v.cliente_id`;

const toSale = (r: SaleRow): SaleForVoucher => ({
  id: r.id,
  branchId: r.sucursal_id,
  registerId: r.caja_id,
  total: r.total,
  state: r.estado_comercial,
  billed: r.se_factura,
  journeyDate: r.fecha_jornada,
  buyer: {
    name: r.razon_social,
    document: r.documento,
    condition: r.condicion_fiscal ?? 'consumidor_final',
  },
  pointOfSale: r.punto_venta_fiscal,
});

export class PgFiscalSales implements FiscalSales {
  constructor(private readonly db: PgDatabase) {}

  async find(tenantId: string, saleId: string): Promise<SaleForVoucher | undefined> {
    const result = await this.db.query<SaleRow>(
      `${SALE_SELECT} WHERE v.tenant_id = $1 AND v.id = $2`,
      [tenantId, saleId],
    );
    const row = result.rows[0];
    return row ? toSale(row) : undefined;
  }

  async findByTicket(tenantId: string, ticket: number): Promise<SaleForVoucher | undefined> {
    const result = await this.db.query<SaleRow>(
      `${SALE_SELECT} WHERE v.tenant_id = $1 AND v.numero_ticket = $2`,
      [tenantId, ticket],
    );
    const row = result.rows[0];
    return row ? toSale(row) : undefined;
  }
}

const FISCAL_TYPES = [
  'comprobante_rechazado',
  'fiscal_sin_caea',
  'fiscal_sin_configurar',
  'caea_no_obtenido',
  'certificado_por_vencer',
  'fiscal_plazo_vencido',
  'reintegro_pendiente',
];

export class PgFiscalAlerts implements FiscalAlerts {
  constructor(private readonly db: PgDatabase) {}

  async raise(a: Parameters<FiscalAlerts['raise']>[0]): Promise<void> {
    const existing = await this.db.query(
      `SELECT 1 FROM alerta
        WHERE tenant_id = $1 AND tipo = $2 AND destinatario_rol = $3 AND resuelta_en IS NULL
          AND referencia IS NOT DISTINCT FROM $4::uuid`,
      [a.tenantId, a.type, a.role, a.reference],
    );
    if (existing.rows.length > 0) return;
    await this.db.query(
      `INSERT INTO alerta (id, tenant_id, sucursal_id, destinatario_rol, tipo, severidad,
         persistente, referencia, detalle, creada_en, proximo_recordatorio)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        randomUUID(),
        a.tenantId,
        a.branchId,
        a.role,
        a.type,
        a.severity,
        a.persistent,
        a.reference,
        a.detail,
        a.at,
        a.nextReminder ?? null,
      ],
    );
  }

  async resolve(tenantId: string, type: string, reference: string | null, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE alerta SET resuelta_en = $4
        WHERE tenant_id = $1 AND tipo = $2 AND resuelta_en IS NULL
          AND referencia IS NOT DISTINCT FROM $3::uuid`,
      [tenantId, type, reference, at],
    );
  }

  async remind(tenantId: string, type: string, now: Date, next: Date): Promise<number> {
    const result = await this.db.query(
      `UPDATE alerta SET proximo_recordatorio = $4,
         detalle = jsonb_set(detalle, '{recordatorios}',
           to_jsonb(COALESCE((detalle->>'recordatorios')::int, 0) + 1))
        WHERE tenant_id = $1 AND tipo = $2 AND resuelta_en IS NULL
          AND proximo_recordatorio <= $3`,
      [tenantId, type, now, next],
    );
    return result.rowCount ?? 0;
  }

  async list(tenantId: string, branchIds: readonly string[] | null): Promise<FiscalAlert[]> {
    const result = await this.db.query<{
      id: string;
      tipo: string;
      severidad: string;
      sucursal_id: string | null;
      destinatario_rol: string;
      referencia: string | null;
      detalle: Record<string, unknown>;
      creada_en: Date;
    }>(
      `SELECT id, tipo, severidad, sucursal_id, destinatario_rol, referencia, detalle, creada_en
         FROM alerta
        WHERE tenant_id = $1 AND resuelta_en IS NULL AND tipo = ANY($2::text[])
          AND destinatario_rol = $3
          AND ($4::uuid[] IS NULL OR sucursal_id = ANY($4::uuid[]))
        ORDER BY creada_en DESC`,
      [tenantId, FISCAL_TYPES, branchIds === null ? 'AC' : 'AS', branchIds],
    );
    return result.rows.map((r) => ({
      id: r.id,
      type: r.tipo,
      severity: r.severidad,
      branchId: r.sucursal_id,
      recipientRole: r.destinatario_rol,
      reference: r.referencia,
      detail: r.detalle,
      createdAt: r.creada_en,
    }));
  }
}
