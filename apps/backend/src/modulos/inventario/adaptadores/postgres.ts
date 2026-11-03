// Repositorios PostgreSQL del módulo de inventario. Tablas aisladas por comercio: se usan dentro
// de una unidad de trabajo con el comercio fijado, y además cada consulta filtra por comercio.
import { randomUUID } from 'node:crypto';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type { MovementType, StockBalance, StockState } from '../dominio/stock.js';
import type { TransferItem, TransferState } from '../dominio/transfers.js';
import type {
  Alert,
  AlertRepository,
  AlertSeverity,
  BranchDirectory,
  CatalogCombo,
  CatalogProduct,
  Movement,
  MovementQuery,
  NewAlert,
  ProductCatalog,
  StockChange,
  StockRepository,
  TransferRepository,
  TransferSummary,
} from '../aplicacion/ports.js';

// Columna de cada estado. Es un mapa fijo: el SQL nunca se arma con valores de la solicitud.
const COLUMN: Record<StockState, string> = {
  disponible: 'disponible',
  reservado: 'reservado',
  en_revision: 'en_revision',
  en_transito: 'en_transito',
};

const BALANCE_COLUMNS =
  'producto_id, disponible, reservado, en_revision, en_transito, umbral_minimo, alerta_activa';

interface BalanceRow {
  producto_id: string;
  disponible: string;
  reservado: string;
  en_revision: string;
  en_transito: string;
  umbral_minimo: string | null;
  alerta_activa: boolean;
}

const toBalance = (row: BalanceRow): StockBalance => ({
  productId: row.producto_id,
  available: row.disponible,
  reserved: row.reservado,
  inReview: row.en_revision,
  inTransit: row.en_transito,
  minimum: row.umbral_minimo,
  alertActive: row.alerta_activa,
});

export class PgStockRepository implements StockRepository {
  constructor(private readonly db: PgDatabase) {}

  async apply(change: StockChange): Promise<StockBalance | undefined> {
    const { from, to } = change.operation;
    const key = [change.tenantId, change.branchId, change.productId];
    let row: BalanceRow | undefined;
    if (from === null) {
      // Entra stock: la fila se crea si el producto todavía no tenía saldo en la sucursal.
      if (to === null) throw new Error('Una operación tiene que tener origen o destino.');
      const column = COLUMN[to];
      const result = await this.db.query<BalanceRow>(
        `INSERT INTO inventario (id, tenant_id, sucursal_id, producto_id, ${column}, actualizado_en)
         VALUES ($4, $1, $2, $3, $5, $6)
         ON CONFLICT (sucursal_id, producto_id) DO UPDATE
           SET ${column} = inventario.${column} + EXCLUDED.${column},
               version = inventario.version + 1, actualizado_en = EXCLUDED.actualizado_en
         WHERE inventario.tenant_id = $1
         RETURNING ${BALANCE_COLUMNS}`,
        [...key, randomUUID(), change.quantity, change.at],
      );
      row = result.rows[0];
    } else {
      // Actualización condicional (AD-04): si el saldo de origen no alcanza, no afecta ninguna
      // fila. Dos operaciones simultáneas sobre la misma fila se serializan por su bloqueo.
      const source = COLUMN[from];
      const target = to === null ? '' : `, ${COLUMN[to]} = ${COLUMN[to]} + $4`;
      const result = await this.db.query<BalanceRow>(
        `UPDATE inventario
            SET ${source} = ${source} - $4${target},
                version = version + 1, actualizado_en = $5
          WHERE tenant_id = $1 AND sucursal_id = $2 AND producto_id = $3 AND ${source} >= $4
          RETURNING ${BALANCE_COLUMNS}`,
        [...key, change.quantity, change.at],
      );
      row = result.rows[0];
    }
    if (!row) return undefined;
    await this.db.query(
      `INSERT INTO movimiento_stock (id, tenant_id, sucursal_id, producto_id, tipo, estado_origen,
         estado_destino, cantidad, referencia, motivo, usuario_id, momento)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        randomUUID(),
        ...key,
        change.operation.type,
        from,
        to,
        change.quantity,
        change.reference,
        change.reason,
        change.userId,
        change.at,
      ],
    );
    return toBalance(row);
  }

  async balances(tenantId: string, branchId: string): Promise<StockBalance[]> {
    const result = await this.db.query<BalanceRow>(
      `SELECT ${BALANCE_COLUMNS} FROM inventario WHERE tenant_id = $1 AND sucursal_id = $2`,
      [tenantId, branchId],
    );
    return result.rows.map(toBalance);
  }

  async balancesOfProduct(tenantId: string, productId: string): Promise<StockBalance[]> {
    const result = await this.db.query<BalanceRow>(
      `SELECT ${BALANCE_COLUMNS} FROM inventario WHERE tenant_id = $1 AND producto_id = $2`,
      [tenantId, productId],
    );
    return result.rows.map(toBalance);
  }

  async setMinimum(
    tenantId: string,
    branchId: string,
    productId: string,
    minimum: string | null,
    at: Date,
  ): Promise<StockBalance> {
    const result = await this.db.query<BalanceRow>(
      `INSERT INTO inventario (id, tenant_id, sucursal_id, producto_id, umbral_minimo, actualizado_en)
       VALUES ($4, $1, $2, $3, $5, $6)
       ON CONFLICT (sucursal_id, producto_id) DO UPDATE
         SET umbral_minimo = EXCLUDED.umbral_minimo,
             version = inventario.version + 1, actualizado_en = EXCLUDED.actualizado_en
       WHERE inventario.tenant_id = $1
       RETURNING ${BALANCE_COLUMNS}`,
      [tenantId, branchId, productId, randomUUID(), minimum, at],
    );
    const row = result.rows[0];
    if (!row) throw new Error('No se pudo guardar el umbral.');
    return toBalance(row);
  }

  async setAlertActive(
    tenantId: string,
    branchId: string,
    productId: string,
    active: boolean,
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE inventario SET alerta_activa = $4
        WHERE tenant_id = $1 AND sucursal_id = $2 AND producto_id = $3 AND alerta_activa <> $4`,
      [tenantId, branchId, productId, active],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

interface MovementRow {
  id: string;
  producto_id: string;
  nombre: string;
  tipo: MovementType;
  estado_origen: StockState | null;
  estado_destino: StockState | null;
  cantidad: string;
  referencia: string | null;
  motivo: string | null;
  usuario_id: string;
  momento: Date;
}

export class PgMovementQuery implements MovementQuery {
  constructor(private readonly db: PgDatabase) {}

  async list(tenantId: string, branchId: string, limit: number): Promise<Movement[]> {
    const result = await this.db.query<MovementRow>(
      `SELECT m.id, m.producto_id, p.nombre, m.tipo, m.estado_origen, m.estado_destino, m.cantidad,
              m.referencia, m.motivo, m.usuario_id, m.momento
         FROM movimiento_stock m JOIN producto p ON p.id = m.producto_id
        WHERE m.tenant_id = $1 AND m.sucursal_id = $2
        ORDER BY m.momento DESC, m.id
        LIMIT $3`,
      [tenantId, branchId, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      productId: row.producto_id,
      productName: row.nombre,
      type: row.tipo,
      from: row.estado_origen,
      to: row.estado_destino,
      quantity: row.cantidad,
      reference: row.referencia,
      reason: row.motivo,
      userId: row.usuario_id,
      at: row.momento,
    }));
  }
}

interface TransferRow {
  id: string;
  tenant_id: string;
  sucursal_origen_id: string;
  sucursal_destino_id: string;
  estado: TransferState;
  emitida_en: Date;
  cerrada_en: Date | null;
}

interface TransferItemRow {
  transferencia_id: string;
  producto_id: string;
  enviada: string;
  recibida: string | null;
  rechazada: string | null;
  faltante: string | null;
}

const TRANSFER_COLUMNS =
  'id, tenant_id, sucursal_origen_id, sucursal_destino_id, estado, emitida_en, cerrada_en';

export class PgTransferRepository implements TransferRepository {
  constructor(private readonly db: PgDatabase) {}

  async insert(t: TransferSummary, by: string, at: Date): Promise<void> {
    await this.db.query(
      `INSERT INTO transferencia (id, tenant_id, sucursal_origen_id, sucursal_destino_id, estado,
         emitida_por, emitida_en)
       VALUES ($1, $2, $3, $4, 'enviada', $5, $6)`,
      [t.id, t.tenantId, t.originId, t.destinationId, by, at],
    );
    for (const item of t.items) {
      await this.db.query(
        `INSERT INTO transferencia_item (id, tenant_id, transferencia_id, producto_id, enviada)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), t.tenantId, t.id, item.productId, item.sent],
      );
    }
  }

  async findForUpdate(tenantId: string, id: string): Promise<TransferSummary | undefined> {
    return this.findOne(tenantId, id, ' FOR UPDATE');
  }

  async find(tenantId: string, id: string): Promise<TransferSummary | undefined> {
    return this.findOne(tenantId, id, '');
  }

  async list(
    tenantId: string,
    branchIds: readonly string[],
    limit: number,
  ): Promise<TransferSummary[]> {
    const result = await this.db.query<TransferRow>(
      `SELECT ${TRANSFER_COLUMNS} FROM transferencia
        WHERE tenant_id = $1
          AND (sucursal_origen_id = ANY($2::uuid[]) OR sucursal_destino_id = ANY($2::uuid[]))
        ORDER BY emitida_en DESC, id
        LIMIT $3`,
      [tenantId, branchIds, limit],
    );
    return this.withItems(tenantId, result.rows);
  }

  async close(
    tenantId: string,
    id: string,
    state: TransferState,
    items: readonly TransferItem[],
    by: string,
    at: Date,
  ): Promise<void> {
    await this.db.query(
      `UPDATE transferencia SET estado = $3, cerrada_por = $4, cerrada_en = $5
        WHERE tenant_id = $1 AND id = $2 AND estado = 'enviada'`,
      [tenantId, id, state, by, at],
    );
    for (const item of items) {
      await this.db.query(
        `UPDATE transferencia_item SET recibida = $4, rechazada = $5, faltante = $6
          WHERE tenant_id = $1 AND transferencia_id = $2 AND producto_id = $3`,
        [tenantId, id, item.productId, item.received, item.rejected, item.missing],
      );
    }
  }

  async pendingForBranch(tenantId: string, branchId: string): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM transferencia
        WHERE tenant_id = $1 AND estado = 'enviada'
          AND (sucursal_origen_id = $2 OR sucursal_destino_id = $2)`,
      [tenantId, branchId],
    );
    return result.rows[0]?.total ?? 0;
  }

  async pendingForProduct(tenantId: string, productId: string): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT count(DISTINCT t.id)::int AS total
         FROM transferencia t JOIN transferencia_item i ON i.transferencia_id = t.id
        WHERE t.tenant_id = $1 AND t.estado = 'enviada' AND i.producto_id = $2`,
      [tenantId, productId],
    );
    return result.rows[0]?.total ?? 0;
  }

  private async findOne(
    tenantId: string,
    id: string,
    lock: string,
  ): Promise<TransferSummary | undefined> {
    const result = await this.db.query<TransferRow>(
      `SELECT ${TRANSFER_COLUMNS} FROM transferencia WHERE tenant_id = $1 AND id = $2${lock}`,
      [tenantId, id],
    );
    return (await this.withItems(tenantId, result.rows))[0];
  }

  private async withItems(tenantId: string, rows: TransferRow[]): Promise<TransferSummary[]> {
    if (rows.length === 0) return [];
    const items = await this.db.query<TransferItemRow>(
      `SELECT i.transferencia_id, i.producto_id, i.enviada, i.recibida, i.rechazada, i.faltante
         FROM transferencia_item i JOIN producto p ON p.id = i.producto_id
        WHERE i.tenant_id = $1 AND i.transferencia_id = ANY($2::uuid[])
        ORDER BY p.nombre`,
      [tenantId, rows.map((row) => row.id)],
    );
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      originId: row.sucursal_origen_id,
      destinationId: row.sucursal_destino_id,
      state: row.estado,
      sentAt: row.emitida_en,
      closedAt: row.cerrada_en,
      items: items.rows
        .filter((item) => item.transferencia_id === row.id)
        .map((item) => ({
          productId: item.producto_id,
          sent: item.enviada,
          received: item.recibida,
          rejected: item.rechazada,
          missing: item.faltante,
        })),
    }));
  }
}

interface AlertRow {
  id: string;
  tenant_id: string;
  sucursal_id: string;
  destinatario_rol: 'AC' | 'AS' | 'VO';
  tipo: string;
  severidad: AlertSeverity;
  referencia: string | null;
  detalle: Record<string, unknown>;
  creada_en: Date;
  resuelta_en: Date | null;
}

const ALERT_COLUMNS =
  'id, tenant_id, sucursal_id, destinatario_rol, tipo, severidad, referencia, detalle, creada_en, resuelta_en';

const toAlert = (row: AlertRow): Alert => ({
  id: row.id,
  tenantId: row.tenant_id,
  branchId: row.sucursal_id,
  recipientRole: row.destinatario_rol,
  type: row.tipo,
  severity: row.severidad,
  reference: row.referencia,
  detail: row.detalle,
  at: row.creada_en,
  resolvedAt: row.resuelta_en,
});

export class PgAlertRepository implements AlertRepository {
  constructor(private readonly db: PgDatabase) {}

  async add(alert: NewAlert): Promise<string> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO alerta (id, tenant_id, sucursal_id, destinatario_rol, tipo, severidad,
         referencia, detalle, creada_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
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
    return id;
  }

  async resolve(
    tenantId: string,
    branchId: string,
    type: string,
    reference: string,
    by: string,
    at: Date,
  ): Promise<void> {
    await this.db.query(
      `UPDATE alerta SET resuelta_en = $5, resuelta_por = $6
        WHERE tenant_id = $1 AND sucursal_id = $2 AND tipo = $3 AND referencia = $4
          AND resuelta_en IS NULL`,
      [tenantId, branchId, type, reference, at, by],
    );
  }

  async pending(tenantId: string, branchId: string, role: 'AC' | 'AS' | 'VO'): Promise<Alert[]> {
    const result = await this.db.query<AlertRow>(
      `SELECT ${ALERT_COLUMNS} FROM alerta
        WHERE tenant_id = $1 AND sucursal_id = $2 AND destinatario_rol = $3 AND resuelta_en IS NULL
        ORDER BY creada_en DESC, id`,
      [tenantId, branchId, role],
    );
    return result.rows.map(toAlert);
  }

  async find(tenantId: string, id: string): Promise<Alert | undefined> {
    const result = await this.db.query<AlertRow>(
      `SELECT ${ALERT_COLUMNS} FROM alerta WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toAlert(row) : undefined;
  }

  async dismiss(tenantId: string, id: string, by: string, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE alerta SET resuelta_en = $3, resuelta_por = $4
        WHERE tenant_id = $1 AND id = $2 AND resuelta_en IS NULL`,
      [tenantId, id, at, by],
    );
  }
}

interface ProductRow {
  id: string;
  nombre: string;
  tipo: 'simple' | 'combo';
  is_active: boolean;
  codigo_barras: string | null;
}

// Lee el catálogo (tablas del módulo de catálogo) sin modificarlo.
export class PgProductCatalog implements ProductCatalog {
  constructor(private readonly db: PgDatabase) {}

  async products(tenantId: string, ids?: readonly string[]): Promise<CatalogProduct[]> {
    const result = await this.db.query<ProductRow>(
      `SELECT id, nombre, tipo, is_active, codigo_barras FROM producto
        WHERE tenant_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
        ORDER BY nombre`,
      [tenantId, ids ?? null],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.nombre,
      type: row.tipo,
      isActive: row.is_active,
      barcode: row.codigo_barras,
    }));
  }

  async combos(tenantId: string): Promise<CatalogCombo[]> {
    const result = await this.db.query<{
      id: string;
      nombre: string;
      is_active: boolean;
      producto_id: string | null;
      cantidad: string | null;
      componente_activo: boolean | null;
    }>(
      `SELECT c.id, c.nombre, c.is_active, cc.producto_id, cc.cantidad,
              p.is_active AS componente_activo
         FROM producto c
         LEFT JOIN combo_componente cc ON cc.combo_id = c.id AND cc.is_active
         LEFT JOIN producto p ON p.id = cc.producto_id
        WHERE c.tenant_id = $1 AND c.tipo = 'combo'
        ORDER BY c.nombre, c.id`,
      [tenantId],
    );
    const combos = new Map<string, CatalogCombo>();
    for (const row of result.rows) {
      const combo = combos.get(row.id) ?? {
        id: row.id,
        name: row.nombre,
        isActive: row.is_active,
        components: [],
      };
      if (row.producto_id !== null && row.cantidad !== null) {
        combo.components.push({
          productId: row.producto_id,
          quantity: row.cantidad,
          isActive: row.componente_activo ?? false,
        });
      }
      combos.set(row.id, combo);
    }
    return [...combos.values()];
  }
}

export class PgBranchDirectory implements BranchDirectory {
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

  async list(tenantId: string): Promise<{ id: string; name: string }[]> {
    const result = await this.db.query<{ id: string; nombre: string }>(
      'SELECT id, nombre FROM sucursal WHERE tenant_id = $1 AND is_active ORDER BY nombre',
      [tenantId],
    );
    return result.rows.map((row) => ({ id: row.id, name: row.nombre }));
  }
}
