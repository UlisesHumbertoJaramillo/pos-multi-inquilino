// Repositorios PostgreSQL de caja. Tablas aisladas por comercio: se usan dentro de una unidad de
// trabajo con el comercio fijado, y además cada consulta filtra por comercio.
import { randomUUID } from 'node:crypto';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type { CashCount, CountResult, MovementType } from '../dominio/cash.js';
import type {
  CashAlert,
  CashAlerts,
  CashAlertType,
  CashRepository,
  CashSettings,
  Journey,
  Register,
  RegisterStatus,
  Shift,
  StoredMovement,
} from '../aplicacion/ports.js';

interface ShiftRow {
  id: string;
  tenant_id: string;
  caja_id: string;
  caja_nombre: string;
  sucursal_id: string;
  jornada_id: string;
  fecha_jornada: string;
  vendedor_id: string;
  vendedor_nombre: string;
  saldo_inicial: string;
  efectivo_anterior: string | null;
  diferencia_inicial: string | null;
  abierto_en: Date;
  estado: 'abierto' | 'cerrado';
  declarado: string | null;
  teorico: string | null;
  diferencia: string | null;
  resultado: CountResult | null;
  cerrado_en: Date | null;
  cerrado_por: string | null;
  forzado: boolean;
}

const SHIFT_SELECT = `SELECT t.id, t.tenant_id, t.caja_id, c.nombre AS caja_nombre, t.sucursal_id,
    t.jornada_id, j.fecha_jornada::text, t.vendedor_id, u.nombre AS vendedor_nombre,
    t.saldo_inicial, t.efectivo_anterior, t.diferencia_inicial, t.abierto_en, t.estado,
    t.declarado, t.teorico, t.diferencia, t.resultado, t.cerrado_en, t.cerrado_por, t.forzado
  FROM turno t
  JOIN caja c ON c.id = t.caja_id
  JOIN jornada j ON j.id = t.jornada_id
  JOIN usuario u ON u.id = t.vendedor_id`;

const toShift = (row: ShiftRow): Shift => ({
  id: row.id,
  tenantId: row.tenant_id,
  registerId: row.caja_id,
  registerName: row.caja_nombre,
  branchId: row.sucursal_id,
  journeyId: row.jornada_id,
  journeyDate: row.fecha_jornada,
  sellerId: row.vendedor_id,
  sellerName: row.vendedor_nombre,
  initial: row.saldo_inicial,
  previousCash: row.efectivo_anterior,
  openingDifference: row.diferencia_inicial,
  openedAt: row.abierto_en,
  status: row.estado,
  count:
    row.declarado !== null && row.teorico !== null && row.diferencia !== null && row.resultado
      ? {
          declared: row.declarado,
          theoretical: row.teorico,
          difference: row.diferencia,
          result: row.resultado,
        }
      : null,
  closedAt: row.cerrado_en,
  closedBy: row.cerrado_por,
  forced: row.forzado,
});

interface JourneyRow {
  id: string;
  tenant_id: string;
  caja_id: string;
  sucursal_id: string;
  fecha_jornada: string;
  abierta_en: Date;
  estado: 'abierta' | 'cerrada';
}

const toJourney = (row: JourneyRow): Journey => ({
  id: row.id,
  tenantId: row.tenant_id,
  registerId: row.caja_id,
  branchId: row.sucursal_id,
  date: row.fecha_jornada,
  openedAt: row.abierta_en,
  status: row.estado,
});

interface MovementRow {
  id: string;
  turno_id: string;
  tipo: MovementType;
  en_efectivo: boolean;
  monto: string;
  motivo: string | null;
  autorizacion_id: string | null;
  registrado_por: string;
  registrado_en: Date;
}

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';

export class PgCashRepository implements CashRepository {
  constructor(private readonly db: PgDatabase) {}

  async lockRegister(tenantId: string, id: string): Promise<Register | undefined> {
    const result = await this.db.query<{
      id: string;
      sucursal_id: string;
      nombre: string;
      is_active: boolean;
    }>(
      `SELECT id, sucursal_id, nombre, is_active FROM caja WHERE tenant_id = $1 AND id = $2
        FOR UPDATE`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row
      ? { id: row.id, branchId: row.sucursal_id, name: row.nombre, isActive: row.is_active }
      : undefined;
  }

  async branchExists(tenantId: string, branchId: string): Promise<boolean> {
    const result = await this.db.query(
      'SELECT 1 FROM sucursal WHERE tenant_id = $1 AND id = $2 AND is_active',
      [tenantId, branchId],
    );
    return result.rows.length > 0;
  }

  async registers(tenantId: string, branchId: string): Promise<RegisterStatus[]> {
    const result = await this.db.query<{
      id: string;
      sucursal_id: string;
      nombre: string;
      is_active: boolean;
      jornada_id: string | null;
      fecha_jornada: string | null;
      abierta_en: Date | null;
      turno_id: string | null;
      vendedor_id: string | null;
      vendedor_nombre: string | null;
      abierto_en: Date | null;
    }>(
      `SELECT c.id, c.sucursal_id, c.nombre, c.is_active,
              j.id AS jornada_id, j.fecha_jornada::text, j.abierta_en,
              t.id AS turno_id, t.vendedor_id, u.nombre AS vendedor_nombre, t.abierto_en
         FROM caja c
         LEFT JOIN jornada j ON j.caja_id = c.id AND j.estado = 'abierta'
         LEFT JOIN turno t ON t.caja_id = c.id AND t.estado = 'abierto'
         LEFT JOIN usuario u ON u.id = t.vendedor_id
        WHERE c.tenant_id = $1 AND c.sucursal_id = $2 AND c.is_active
        ORDER BY c.nombre, c.id`,
      [tenantId, branchId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      branchId: row.sucursal_id,
      name: row.nombre,
      isActive: row.is_active,
      journey:
        row.jornada_id && row.fecha_jornada && row.abierta_en
          ? { id: row.jornada_id, date: row.fecha_jornada, openedAt: row.abierta_en }
          : null,
      openShift:
        row.turno_id && row.vendedor_id && row.abierto_en
          ? {
              id: row.turno_id,
              sellerId: row.vendedor_id,
              sellerName: row.vendedor_nombre ?? '',
              openedAt: row.abierto_en,
            }
          : null,
    }));
  }

  async openJourney(tenantId: string, registerId: string): Promise<Journey | undefined> {
    const result = await this.db.query<JourneyRow>(
      `SELECT id, tenant_id, caja_id, sucursal_id, fecha_jornada::text, abierta_en, estado
         FROM jornada WHERE tenant_id = $1 AND caja_id = $2 AND estado = 'abierta'`,
      [tenantId, registerId],
    );
    const row = result.rows[0];
    return row ? toJourney(row) : undefined;
  }

  async insertJourney(j: Journey): Promise<void> {
    await this.db.query(
      `INSERT INTO jornada (id, tenant_id, caja_id, sucursal_id, fecha_jornada, abierta_en)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [j.id, j.tenantId, j.registerId, j.branchId, j.date, j.openedAt],
    );
  }

  async closeJourney(
    tenantId: string,
    id: string,
    count: CashCount,
    by: string,
    at: Date,
  ): Promise<void> {
    await this.db.query(
      `UPDATE jornada SET estado = 'cerrada', declarado_z = $3, teorico_z = $4, diferencia_z = $5,
         resultado_z = $6, cerrada_en = $7, cerrada_por = $8
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, count.declared, count.theoretical, count.difference, count.result, at, by],
    );
  }

  async shiftsOfJourney(tenantId: string, journeyId: string): Promise<Shift[]> {
    const result = await this.db.query<ShiftRow>(
      `${SHIFT_SELECT} WHERE t.tenant_id = $1 AND t.jornada_id = $2 ORDER BY t.abierto_en, t.id`,
      [tenantId, journeyId],
    );
    return result.rows.map(toShift);
  }

  async openShiftOfSeller(tenantId: string, sellerId: string): Promise<Shift | undefined> {
    const result = await this.db.query<ShiftRow>(
      `${SHIFT_SELECT} WHERE t.tenant_id = $1 AND t.vendedor_id = $2 AND t.estado = 'abierto'`,
      [tenantId, sellerId],
    );
    const row = result.rows[0];
    return row ? toShift(row) : undefined;
  }

  async findShift(tenantId: string, id: string, lock: boolean): Promise<Shift | undefined> {
    const result = await this.db.query<ShiftRow>(
      `${SHIFT_SELECT} WHERE t.tenant_id = $1 AND t.id = $2${lock ? ' FOR UPDATE OF t' : ''}`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toShift(row) : undefined;
  }

  async insertShift(s: Shift): Promise<boolean> {
    // Un punto de guardado: si la base rechaza el turno, la transacción sigue utilizable.
    await this.db.query('SAVEPOINT turno_apertura');
    try {
      await this.db.query(
        `INSERT INTO turno (id, tenant_id, caja_id, sucursal_id, jornada_id, vendedor_id,
           saldo_inicial, efectivo_anterior, diferencia_inicial, abierto_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          s.id,
          s.tenantId,
          s.registerId,
          s.branchId,
          s.journeyId,
          s.sellerId,
          s.initial,
          s.previousCash,
          s.openingDifference,
          s.openedAt,
        ],
      );
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error;
      await this.db.query('ROLLBACK TO SAVEPOINT turno_apertura');
      return false;
    }
    await this.db.query('RELEASE SAVEPOINT turno_apertura');
    return true;
  }

  async closeShift(
    tenantId: string,
    id: string,
    count: CashCount,
    by: string,
    at: Date,
    forced: boolean,
  ): Promise<void> {
    await this.db.query(
      `UPDATE turno SET estado = 'cerrado', declarado = $3, teorico = $4, diferencia = $5,
         resultado = $6, cerrado_en = $7, cerrado_por = $8, forzado = $9
        WHERE tenant_id = $1 AND id = $2`,
      [
        tenantId,
        id,
        count.declared,
        count.theoretical,
        count.difference,
        count.result,
        at,
        by,
        forced,
      ],
    );
  }

  async openShifts(tenantId: string, branchId: string): Promise<Shift[]> {
    const result = await this.db.query<ShiftRow>(
      `${SHIFT_SELECT} WHERE t.tenant_id = $1 AND t.sucursal_id = $2 AND t.estado = 'abierto'
        ORDER BY c.nombre, t.abierto_en`,
      [tenantId, branchId],
    );
    return result.rows.map(toShift);
  }

  async addMovement(tenantId: string, m: StoredMovement): Promise<void> {
    await this.db.query(
      `INSERT INTO movimiento_caja (id, tenant_id, turno_id, tipo, en_efectivo, monto, motivo,
         autorizacion_id, registrado_por, registrado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        m.id,
        tenantId,
        m.shiftId,
        m.type,
        m.inCash,
        m.amount,
        m.reason,
        m.authorizationId,
        m.userId,
        m.at,
      ],
    );
  }

  async movements(tenantId: string, shiftIds: readonly string[]): Promise<StoredMovement[]> {
    if (shiftIds.length === 0) return [];
    const result = await this.db.query<MovementRow>(
      `SELECT id, turno_id, tipo, en_efectivo, monto, motivo, autorizacion_id, registrado_por,
              registrado_en
         FROM movimiento_caja WHERE tenant_id = $1 AND turno_id = ANY($2::uuid[])
        ORDER BY registrado_en, id`,
      [tenantId, shiftIds],
    );
    return result.rows.map((row) => ({
      id: row.id,
      shiftId: row.turno_id,
      type: row.tipo,
      inCash: row.en_efectivo,
      amount: row.monto,
      reason: row.motivo,
      authorizationId: row.autorizacion_id,
      userId: row.registrado_por,
      at: row.registrado_en,
    }));
  }

  // Turnos abiertos que impiden dar de baja una sucursal, una caja o un usuario (D-42).
  async countOpenShifts(
    tenantId: string,
    filter: { branchId?: string; registerId?: string; userId?: string },
  ): Promise<number> {
    const result = await this.db.query<{ total: string }>(
      `SELECT count(*) AS total FROM turno
        WHERE tenant_id = $1 AND estado = 'abierto'
          AND ($2::uuid IS NULL OR sucursal_id = $2)
          AND ($3::uuid IS NULL OR caja_id = $3)
          AND ($4::uuid IS NULL OR vendedor_id = $4)`,
      [tenantId, filter.branchId ?? null, filter.registerId ?? null, filter.userId ?? null],
    );
    return Number(result.rows[0]?.total ?? 0);
  }
}

// Tolerancia de arqueo (parámetros del comercio) y zona horaria (comercio), sin modificarlos.
// Sin parámetros guardados rige la tolerancia por defecto de la plataforma.
export class PgCashSettings implements CashSettings {
  constructor(
    private readonly db: PgDatabase,
    private readonly defaultTolerance: string,
  ) {}

  async tolerance(tenantId: string): Promise<string> {
    const result = await this.db.query<{ tolerancia_arqueo: string }>(
      'SELECT tolerancia_arqueo FROM parametro_comercio WHERE tenant_id = $1',
      [tenantId],
    );
    return result.rows[0]?.tolerancia_arqueo ?? this.defaultTolerance;
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
}

// Alertas de caja en la tabla común de alertas (plan §3.13).
export class PgCashAlerts implements CashAlerts {
  constructor(private readonly db: PgDatabase) {}

  async add(alert: CashAlert): Promise<void> {
    await this.db.query(
      `INSERT INTO alerta (id, tenant_id, sucursal_id, destinatario_rol, tipo, severidad,
         referencia, detalle, creada_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        randomUUID(),
        alert.tenantId,
        alert.branchId,
        alert.recipientRole,
        alert.type,
        alert.severity,
        alert.reference,
        alert.detail,
        alert.at,
      ],
    );
  }

  async hasPending(tenantId: string, type: CashAlertType, reference: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT 1 FROM alerta
        WHERE tenant_id = $1 AND tipo = $2 AND referencia = $3 AND resuelta_en IS NULL`,
      [tenantId, type, reference],
    );
    return result.rows.length > 0;
  }

  async resolve(
    tenantId: string,
    type: CashAlertType,
    reference: string,
    by: string,
    at: Date,
  ): Promise<void> {
    await this.db.query(
      `UPDATE alerta SET resuelta_en = $4, resuelta_por = $5
        WHERE tenant_id = $1 AND tipo = $2 AND referencia = $3 AND resuelta_en IS NULL`,
      [tenantId, type, reference, at, by],
    );
  }
}
