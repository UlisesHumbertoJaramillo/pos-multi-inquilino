// Puertos de salida del módulo de inventario. Los repositorios trabajan dentro de una unidad de
// trabajo con el comercio fijado (seguridad a nivel de fila) y además filtran por comercio.
import type { MovementType, StockBalance, StockOperation, StockState } from '../dominio/stock.js';
import type { Transfer, TransferItem, TransferState } from '../dominio/transfers.js';

export interface StockChange {
  tenantId: string;
  branchId: string;
  productId: string;
  operation: StockOperation;
  quantity: string;
  reference: string | null;
  reason: string | null;
  userId: string;
  at: Date;
}

export interface StockRepository {
  // Aplica la operación con una actualización condicional (AD-04) y escribe su movimiento.
  // Devuelve el saldo resultante, o undefined si el estado de origen no alcanzaba: en ese caso no
  // se modificó ninguna fila.
  apply(change: StockChange): Promise<StockBalance | undefined>;
  balances(tenantId: string, branchId: string): Promise<StockBalance[]>;
  // Saldos de un producto en todas las sucursales del comercio.
  balancesOfProduct(tenantId: string, productId: string): Promise<StockBalance[]>;
  setMinimum(
    tenantId: string,
    branchId: string,
    productId: string,
    minimum: string | null,
    at: Date,
  ): Promise<StockBalance>;
  // Cambia la marca de alerta solo si tenía el valor contrario; devuelve si la cambió.
  setAlertActive(
    tenantId: string,
    branchId: string,
    productId: string,
    active: boolean,
  ): Promise<boolean>;
}

export interface Movement {
  id: string;
  productId: string;
  productName: string;
  type: MovementType;
  from: StockState | null;
  to: StockState | null;
  quantity: string;
  reference: string | null;
  reason: string | null;
  userId: string;
  at: Date;
}

export interface MovementQuery {
  list(tenantId: string, branchId: string, limit: number): Promise<Movement[]>;
}

export interface TransferSummary extends Transfer {
  sentAt: Date;
  closedAt: Date | null;
}

export interface TransferRepository {
  insert(transfer: Transfer, by: string, at: Date): Promise<void>;
  // Toma la transferencia con bloqueo de fila: dos recepciones simultáneas no la cierran dos veces.
  findForUpdate(tenantId: string, id: string): Promise<TransferSummary | undefined>;
  find(tenantId: string, id: string): Promise<TransferSummary | undefined>;
  // De las sucursales indicadas, como origen o destino; las más recientes primero.
  list(tenantId: string, branchIds: readonly string[], limit: number): Promise<TransferSummary[]>;
  close(
    tenantId: string,
    id: string,
    state: TransferState,
    items: readonly TransferItem[],
    by: string,
    at: Date,
  ): Promise<void>;
  pendingForBranch(tenantId: string, branchId: string): Promise<number>;
  pendingForProduct(tenantId: string, productId: string): Promise<number>;
}

export type AlertSeverity = 'info' | 'advertencia' | 'critica';

export interface NewAlert {
  tenantId: string;
  branchId: string;
  recipientRole: 'AC' | 'AS' | 'VO';
  type: string;
  severity: AlertSeverity;
  reference: string | null;
  detail: Record<string, unknown>;
  at: Date;
}

export interface Alert extends NewAlert {
  id: string;
  resolvedAt: Date | null;
}

export interface AlertRepository {
  add(alert: NewAlert): Promise<string>;
  // Resuelve las alertas pendientes de ese tipo y referencia en la sucursal (por ejemplo, la de
  // stock mínimo de un producto al rearmarse).
  resolve(
    tenantId: string,
    branchId: string,
    type: string,
    reference: string,
    by: string,
    at: Date,
  ): Promise<void>;
  pending(tenantId: string, branchId: string, role: 'AC' | 'AS' | 'VO'): Promise<Alert[]>;
  find(tenantId: string, id: string): Promise<Alert | undefined>;
  dismiss(tenantId: string, id: string, by: string, at: Date): Promise<void>;
}

export interface CatalogProduct {
  id: string;
  name: string;
  type: 'simple' | 'combo';
  isActive: boolean;
  barcode: string | null;
}

export interface CatalogCombo {
  id: string;
  name: string;
  isActive: boolean;
  components: { productId: string; quantity: string; isActive: boolean }[];
}

// Lectura del catálogo que necesita el inventario: nombres, tipo y combos.
export interface ProductCatalog {
  products(tenantId: string, ids?: readonly string[]): Promise<CatalogProduct[]>;
  combos(tenantId: string): Promise<CatalogCombo[]>;
}

export interface BranchDirectory {
  // Sucursal activa del comercio, o undefined.
  find(tenantId: string, branchId: string): Promise<{ id: string; name: string } | undefined>;
  list(tenantId: string): Promise<{ id: string; name: string }[]>;
}
