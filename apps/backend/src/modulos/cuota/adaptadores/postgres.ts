// Repositorios PostgreSQL de la cuota de descuento. Tablas aisladas por comercio: se usan dentro
// de una unidad de trabajo con el comercio fijado, y además cada consulta filtra por comercio.
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type {
  AssignedQuota,
  DayBalance,
  QuotaDirectory,
  QuotaKey,
  QuotaLimits,
  QuotaRepository,
  Seller,
} from '../aplicacion/quotas.js';

interface LimitsRow {
  pct_max_venta: string;
  monto: string;
}

const toLimits = (row: LimitsRow): QuotaLimits => ({
  percent: row.pct_max_venta,
  amount: row.monto,
});

interface BalanceRow {
  id: string;
  usuario_id: string;
  fecha_jornada: string;
  saldo: string;
}

const toBalance = (row: BalanceRow): DayBalance => ({
  journeyDate: row.fecha_jornada,
  balance: row.saldo,
});

export class PgQuotaRepository implements QuotaRepository {
  constructor(private readonly db: PgDatabase) {}

  async cap(tenantId: string): Promise<QuotaLimits | undefined> {
    const result = await this.db.query<LimitsRow>(
      'SELECT pct_max_venta, monto_max AS monto FROM tope_cuota WHERE tenant_id = $1',
      [tenantId],
    );
    const row = result.rows[0];
    return row ? toLimits(row) : undefined;
  }

  async saveCap(tenantId: string, cap: QuotaLimits, by: string, at: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO tope_cuota (tenant_id, pct_max_venta, monto_max, actualizado_en, actualizado_por)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id) DO UPDATE SET pct_max_venta = EXCLUDED.pct_max_venta,
         monto_max = EXCLUDED.monto_max, actualizado_en = EXCLUDED.actualizado_en,
         actualizado_por = EXCLUDED.actualizado_por`,
      [tenantId, cap.percent, cap.amount, at, by],
    );
  }

  async lockAll(tenantId: string): Promise<AssignedQuota[]> {
    const result = await this.db.query<LimitsRow & { usuario_id: string; sucursal_id: string }>(
      `SELECT usuario_id, sucursal_id, pct_max_venta, monto FROM cuota_vo
        WHERE tenant_id = $1 ORDER BY sucursal_id, usuario_id FOR UPDATE`,
      [tenantId],
    );
    return result.rows.map((row) => ({
      tenantId,
      userId: row.usuario_id,
      branchId: row.sucursal_id,
      limits: toLimits(row),
    }));
  }

  async quota(key: QuotaKey, lock: boolean): Promise<QuotaLimits | undefined> {
    const result = await this.db.query<LimitsRow>(
      `SELECT pct_max_venta, monto FROM cuota_vo
        WHERE tenant_id = $1 AND usuario_id = $2 AND sucursal_id = $3${lock ? ' FOR UPDATE' : ''}`,
      [key.tenantId, key.userId, key.branchId],
    );
    const row = result.rows[0];
    return row ? toLimits(row) : undefined;
  }

  async saveQuota(id: string, quota: AssignedQuota, by: string, at: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO cuota_vo (id, tenant_id, usuario_id, sucursal_id, pct_max_venta, monto,
         actualizado_en, actualizado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, usuario_id, sucursal_id) DO UPDATE SET
         pct_max_venta = EXCLUDED.pct_max_venta, monto = EXCLUDED.monto,
         actualizado_en = EXCLUDED.actualizado_en, actualizado_por = EXCLUDED.actualizado_por`,
      [
        id,
        quota.tenantId,
        quota.userId,
        quota.branchId,
        quota.limits.percent,
        quota.limits.amount,
        at,
        by,
      ],
    );
  }

  async branchQuotas(tenantId: string, branchId: string): Promise<Map<string, QuotaLimits>> {
    const result = await this.db.query<LimitsRow & { usuario_id: string }>(
      `SELECT usuario_id, pct_max_venta, monto FROM cuota_vo
        WHERE tenant_id = $1 AND sucursal_id = $2`,
      [tenantId, branchId],
    );
    return new Map(result.rows.map((row) => [row.usuario_id, toLimits(row)]));
  }

  async latestBalances(tenantId: string, branchId: string): Promise<Map<string, DayBalance>> {
    const result = await this.db.query<BalanceRow>(
      `SELECT DISTINCT ON (usuario_id) id, usuario_id, fecha_jornada::text, saldo
         FROM saldo_cuota WHERE tenant_id = $1 AND sucursal_id = $2
        ORDER BY usuario_id, fecha_jornada DESC`,
      [tenantId, branchId],
    );
    return new Map(result.rows.map((row) => [row.usuario_id, toBalance(row)]));
  }

  async lockLatestBalance(key: QuotaKey): Promise<(DayBalance & { id: string }) | undefined> {
    const result = await this.db.query<BalanceRow>(
      `SELECT id, usuario_id, fecha_jornada::text, saldo FROM saldo_cuota
        WHERE tenant_id = $1 AND usuario_id = $2 AND sucursal_id = $3
        ORDER BY fecha_jornada DESC LIMIT 1 FOR UPDATE`,
      [key.tenantId, key.userId, key.branchId],
    );
    const row = result.rows[0];
    return row ? { id: row.id, ...toBalance(row) } : undefined;
  }

  async setBalance(tenantId: string, id: string, balance: string, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE saldo_cuota SET saldo = $3, version = version + 1, actualizado_en = $4
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id, balance, at],
    );
  }

  async openBalance(id: string, key: QuotaKey, day: DayBalance, at: Date): Promise<string> {
    // Si dos turnos abren a la vez, el segundo no restablece el saldo: la fila única lo impide.
    await this.db.query(
      `INSERT INTO saldo_cuota (id, tenant_id, usuario_id, sucursal_id, fecha_jornada, saldo,
         creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (tenant_id, usuario_id, sucursal_id, fecha_jornada) DO NOTHING`,
      [id, key.tenantId, key.userId, key.branchId, day.journeyDate, day.balance, at],
    );
    const result = await this.db.query<{ saldo: string }>(
      `SELECT saldo FROM saldo_cuota
        WHERE tenant_id = $1 AND usuario_id = $2 AND sucursal_id = $3 AND fecha_jornada = $4`,
      [key.tenantId, key.userId, key.branchId, day.journeyDate],
    );
    const row = result.rows[0];
    if (!row) throw new Error('No se pudo leer el saldo de la cuota.');
    return row.saldo;
  }

  async consume(
    key: QuotaKey,
    journeyDate: string,
    amount: string,
    at: Date,
  ): Promise<string | undefined> {
    const result = await this.db.query<{ saldo: string }>(
      `UPDATE saldo_cuota SET saldo = saldo - $5, version = version + 1, actualizado_en = $6
        WHERE tenant_id = $1 AND usuario_id = $2 AND sucursal_id = $3 AND fecha_jornada = $4
          AND saldo >= $5
        RETURNING saldo`,
      [key.tenantId, key.userId, key.branchId, journeyDate, amount, at],
    );
    return result.rows[0]?.saldo;
  }
}

// Sucursales y vendedores del comercio, sin modificarlos. usuario y usuario_rol son tablas de
// identidad sin seguridad a nivel de fila: se filtra por comercio en la consulta.
export class PgQuotaDirectory implements QuotaDirectory {
  constructor(private readonly db: PgDatabase) {}

  async branch(tenantId: string, branchId: string) {
    const result = await this.db.query<{ id: string; nombre: string }>(
      'SELECT id, nombre FROM sucursal WHERE tenant_id = $1 AND id = $2 AND is_active',
      [tenantId, branchId],
    );
    const row = result.rows[0];
    return row ? { id: row.id, name: row.nombre } : undefined;
  }

  async sellers(tenantId: string, branchId: string): Promise<Seller[]> {
    const result = await this.db.query<{ id: string; nombre: string; email: string }>(
      `SELECT u.id, u.nombre, u.email FROM usuario u
         JOIN usuario_rol r ON r.usuario_id = u.id
        WHERE u.tenant_id = $1 AND r.sucursal_id = $2 AND r.rol = 'VO' AND u.is_active
        ORDER BY u.nombre, u.id`,
      [tenantId, branchId],
    );
    return result.rows.map((row) => ({ id: row.id, name: row.nombre, email: row.email }));
  }
}
