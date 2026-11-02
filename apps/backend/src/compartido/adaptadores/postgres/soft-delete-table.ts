// Base reutilizable para repositorios de tablas con baja lógica (T-023, Const. 5, AD-18).
// - Lista y busca solo los registros activos, salvo que se pidan los inactivos.
// - Filtra siempre por comercio (RN-01): un registro de otro comercio es igual a uno inexistente.
// - La baja es un UPDATE de is_active, desactivado_en y desactivado_por; nunca un DELETE.
// La tabla lleva esas columnas y tenant_id (ver docs/arquitectura/guia-nuevo-modulo.md).
import type pg from 'pg';
import type { PgDatabase } from './pg-database.js';

export interface ReadOptions {
  includeInactive?: boolean;
}

export type DeactivationResult = 'deactivated' | 'already_inactive' | 'not_found';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export class PgSoftDeleteTable<Row extends pg.QueryResultRow> {
  constructor(
    private readonly db: PgDatabase,
    private readonly table: string,
  ) {
    // El nombre de la tabla va dentro del SQL: solo se aceptan identificadores simples.
    if (!IDENTIFIER.test(table)) {
      throw new Error(`Nombre de tabla no válido: ${table}`);
    }
  }

  async findById(
    tenantId: string,
    id: string,
    options: ReadOptions = {},
  ): Promise<Row | undefined> {
    const result = await this.db.query<Row>(
      `SELECT * FROM ${this.table}
        WHERE tenant_id = $1 AND id = $2 AND ($3 OR is_active)`,
      [tenantId, id, options.includeInactive === true],
    );
    return result.rows[0];
  }

  async list(tenantId: string, options: ReadOptions = {}): Promise<Row[]> {
    const result = await this.db.query<Row>(
      `SELECT * FROM ${this.table}
        WHERE tenant_id = $1 AND ($2 OR is_active)
        ORDER BY id`,
      [tenantId, options.includeInactive === true],
    );
    return result.rows;
  }

  async deactivate(
    tenantId: string,
    id: string,
    by: string,
    at: Date,
  ): Promise<DeactivationResult> {
    const updated = await this.db.query(
      `UPDATE ${this.table}
          SET is_active = false, desactivado_en = $3, desactivado_por = $4
        WHERE tenant_id = $1 AND id = $2 AND is_active`,
      [tenantId, id, at, by],
    );
    if (updated.rowCount === 1) return 'deactivated';
    const existing = await this.findById(tenantId, id, { includeInactive: true });
    return existing ? 'already_inactive' : 'not_found';
  }
}
