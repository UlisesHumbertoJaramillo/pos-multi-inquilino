// Repositorios PostgreSQL del módulo de promociones. Tabla aislada por comercio: se usa dentro de
// una unidad de trabajo con el comercio fijado, y además cada consulta filtra por comercio.
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type {
  Promotion,
  PromotionRule,
  PromotionScope,
  PromotionType,
} from '../dominio/promotions.js';
import type { PromotionRepository, PromotionTargets } from '../aplicacion/promotions.js';

interface PromotionRow {
  id: string;
  tenant_id: string;
  nombre: string;
  tipo: PromotionType;
  alcance: PromotionScope;
  producto_id: string | null;
  categoria_id: string | null;
  parametros: Record<string, unknown>;
  vigente_desde: Date;
  vigente_hasta: Date;
  sucursales: string[] | null;
  is_active: boolean;
}

const COLUMNS = `id, tenant_id, nombre, tipo, alcance, producto_id, categoria_id, parametros,
  vigente_desde, vigente_hasta, sucursales, is_active`;

// Regla ↔ parámetros en jsonb (ver la migración).
function toRule(type: PromotionType, p: Record<string, unknown>): PromotionRule {
  switch (type) {
    case 'nxm':
      return { type, take: Number(p.lleva), pay: Number(p.paga) };
    case 'porcentaje':
      return { type, percent: String(p.porcentaje) };
    case 'precio_cantidad':
      return { type, quantity: Number(p.cantidad), price: String(p.precio) };
  }
}

function toParameters(rule: PromotionRule): Record<string, unknown> {
  switch (rule.type) {
    case 'nxm':
      return { lleva: rule.take, paga: rule.pay };
    case 'porcentaje':
      return { porcentaje: rule.percent };
    case 'precio_cantidad':
      return { cantidad: rule.quantity, precio: rule.price };
  }
}

const toPromotion = (row: PromotionRow): Promotion => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.nombre,
  rule: toRule(row.tipo, row.parametros),
  scope: row.alcance,
  targetId: (row.alcance === 'producto' ? row.producto_id : row.categoria_id) ?? '',
  validFrom: row.vigente_desde,
  validUntil: row.vigente_hasta,
  branchIds: row.sucursales,
  isActive: row.is_active,
});

export class PgPromotionRepository implements PromotionRepository {
  constructor(private readonly db: PgDatabase) {}

  async list(tenantId: string, includeInactive: boolean): Promise<Promotion[]> {
    const result = await this.db.query<PromotionRow>(
      `SELECT ${COLUMNS} FROM promocion WHERE tenant_id = $1 AND ($2 OR is_active)
        ORDER BY vigente_desde DESC, creado_en, id`,
      [tenantId, includeInactive],
    );
    return result.rows.map(toPromotion);
  }

  async findById(tenantId: string, id: string): Promise<Promotion | undefined> {
    const result = await this.db.query<PromotionRow>(
      `SELECT ${COLUMNS} FROM promocion WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toPromotion(row) : undefined;
  }

  async insert(p: Promotion, at: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO promocion (id, tenant_id, nombre, tipo, alcance, producto_id, categoria_id,
         parametros, vigente_desde, vigente_hasta, sucursales, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [p.id, p.tenantId, ...this.values(p), at],
    );
  }

  async update(p: Promotion): Promise<void> {
    await this.db.query(
      `UPDATE promocion SET nombre = $3, tipo = $4, alcance = $5, producto_id = $6,
         categoria_id = $7, parametros = $8, vigente_desde = $9, vigente_hasta = $10,
         sucursales = $11
        WHERE tenant_id = $2 AND id = $1`,
      [p.id, p.tenantId, ...this.values(p)],
    );
  }

  async deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE promocion SET is_active = false, desactivado_en = $3, desactivado_por = $4
        WHERE tenant_id = $1 AND id = $2 AND is_active`,
      [tenantId, id, at, by],
    );
  }

  private values(p: Promotion): unknown[] {
    return [
      p.name,
      p.rule.type,
      p.scope,
      p.scope === 'producto' ? p.targetId : null,
      p.scope === 'categoria' ? p.targetId : null,
      toParameters(p.rule),
      p.validFrom,
      p.validUntil,
      p.branchIds,
    ];
  }
}

// Lee productos, categorías y sucursales sin modificarlos.
export class PgPromotionTargets implements PromotionTargets {
  constructor(private readonly db: PgDatabase) {}

  async target(tenantId: string, scope: PromotionScope, id: string) {
    const table = scope === 'producto' ? 'producto' : 'categoria';
    const result = await this.db.query<{ id: string; nombre: string; is_active: boolean }>(
      `SELECT id, nombre, is_active FROM ${table} WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? { id: row.id, name: row.nombre, isActive: row.is_active } : undefined;
  }

  async names(tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const result = await this.db.query<{ id: string; nombre: string }>(
      `SELECT id, nombre FROM producto WHERE tenant_id = $1 AND id = ANY($2::uuid[])
       UNION ALL
       SELECT id, nombre FROM categoria WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, ids],
    );
    return new Map(result.rows.map((row) => [row.id, row.nombre]));
  }

  async activeBranches(tenantId: string): Promise<string[]> {
    const result = await this.db.query<{ id: string }>(
      'SELECT id FROM sucursal WHERE tenant_id = $1 AND is_active',
      [tenantId],
    );
    return result.rows.map((row) => row.id);
  }
}
