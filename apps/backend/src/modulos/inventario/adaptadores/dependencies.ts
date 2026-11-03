// Lo que el inventario aporta a los controles de baja de otros módulos (D-42, RF-025, RF-148):
// reservas y transferencias pendientes de un producto, y stock y transferencias de una sucursal.
// Se consulta dentro de la unidad de trabajo del caso de uso que da de baja.
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import { PgTransferRepository } from './postgres.js';

export class PgInventoryDependencies {
  private readonly transfers: PgTransferRepository;

  constructor(private readonly db: PgDatabase) {
    this.transfers = new PgTransferRepository(db);
  }

  async forProduct(
    tenantId: string,
    productId: string,
  ): Promise<{ reservations: number; pendingPurchases: number; pendingTransfers: number }> {
    const reserved = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM inventario
        WHERE tenant_id = $1 AND producto_id = $2 AND reservado > 0`,
      [tenantId, productId],
    );
    return {
      reservations: reserved.rows[0]?.total ?? 0,
      // Las compras pendientes las aporta el módulo de proveedores (raíz de composición).
      pendingPurchases: 0,
      pendingTransfers: await this.transfers.pendingForProduct(tenantId, productId),
    };
  }

  async forBranch(
    tenantId: string,
    branchId: string,
  ): Promise<{ pendingTransfers: number; stockedProducts: number }> {
    const stocked = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM inventario
        WHERE tenant_id = $1 AND sucursal_id = $2
          AND (disponible > 0 OR en_revision > 0 OR en_transito > 0)`,
      [tenantId, branchId],
    );
    return {
      pendingTransfers: await this.transfers.pendingForBranch(tenantId, branchId),
      stockedProducts: stocked.rows[0]?.total ?? 0,
    };
  }
}
