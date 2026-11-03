// Stock de la sucursal del AS: consulta, ajustes, umbrales, mermas, revisión, alertas y
// disponibilidad de combos (T-090 a T-092, T-096, T-097; RF-040 a RF-043, RF-052, RF-088).
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import { comboAvailability } from '../../catalogo/aplicacion/combos.js';
import {
  adjustmentOperation,
  assertReason,
  normalizeMinimum,
  normalizeQuantity,
  type StockBalance,
  type WasteReason,
} from '../dominio/stock.js';
import { InventoryUseCase } from './ledger.js';
import type { Alert, CatalogProduct, Movement } from './ports.js';

const ADJUST = 'inventario.ajustar' as const;
const MAX_MOVEMENTS = 200;

export interface StockRow {
  product: CatalogProduct;
  balance: StockBalance;
}

const emptyBalance = (productId: string): StockBalance => ({
  productId,
  available: '0.000',
  reserved: '0.000',
  inReview: '0.000',
  inTransit: '0.000',
  minimum: null,
  alertActive: false,
});

// Saldos de todos los productos simples activos (los que no tienen fila valen cero) y de los
// dados de baja que todavía tienen stock.
export class ListStock extends InventoryUseCase {
  async execute(context: SecurityContext, branchId: string): Promise<StockRow[]> {
    return this.inBranch(context, ADJUST, branchId, async (actor) => {
      const balances = new Map(
        (await this.deps.stock.balances(actor.tenantId, branchId)).map((b) => [b.productId, b]),
      );
      const products = await this.deps.catalog.products(actor.tenantId);
      return products
        .filter((p) => p.type === 'simple' && (p.isActive || balances.has(p.id)))
        .map((product) => ({
          product,
          balance: balances.get(product.id) ?? emptyBalance(product.id),
        }));
    });
  }
}

// Ajuste con signo y motivo (RF-040). Un ajuste que deja el disponible negativo se rechaza
// (RF-043): la actualización condicional no afecta ninguna fila.
export class AdjustStock extends InventoryUseCase {
  async execute(
    context: SecurityContext,
    branchId: string,
    input: { productId: string; delta: string; reason: string },
  ): Promise<StockBalance> {
    return this.inBranch(context, ADJUST, branchId, async (actor) => {
      const product = await this.stockable(context, actor, input.productId);
      const { operation, quantity } = adjustmentOperation(input.delta);
      const reason = assertReason(input.reason);
      const balance = await this.ledger.apply(actor, {
        branchId,
        product,
        operation,
        quantity,
        reason,
      });
      await this.record(actor, branchId, 'stock_ajuste', 'inventario', product.id, null, {
        sucursalId: branchId,
        delta: operation === 'ajustarSuma' ? quantity : `-${quantity}`,
        motivo: reason,
        disponible: balance.available,
      });
      return balance;
    });
  }
}

export class SetMinimum extends InventoryUseCase {
  async execute(
    context: SecurityContext,
    branchId: string,
    productId: string,
    minimum: string | null,
  ): Promise<StockBalance> {
    return this.inBranch(context, ADJUST, branchId, async (actor) => {
      const product = await this.stockable(context, actor, productId);
      const value = normalizeMinimum(minimum);
      const balance = await this.deps.stock.setMinimum(
        actor.tenantId,
        branchId,
        productId,
        value,
        actor.at,
      );
      // Con el umbral nuevo, el disponible puede quedar por debajo o volver a superarlo.
      const alertActive = await this.ledger.checkThreshold(actor, branchId, product, balance);
      await this.record(actor, branchId, 'stock_umbral', 'inventario', productId, null, {
        sucursalId: branchId,
        umbral: value,
      });
      return { ...balance, alertActive };
    });
  }
}

// Merma por rotura, vencimiento o pérdida (RF-042): descuenta el disponible con su motivo y no
// mueve dinero.
export class RecordWaste extends InventoryUseCase {
  async execute(
    context: SecurityContext,
    branchId: string,
    input: { productId: string; quantity: string; reason: WasteReason; note?: string | null },
  ): Promise<StockBalance> {
    return this.inBranch(context, ADJUST, branchId, async (actor) => {
      const product = await this.stockable(context, actor, input.productId, false);
      const quantity = normalizeQuantity(input.quantity);
      const note = input.note?.trim() ? assertReason(input.note, 'La observación') : null;
      const reason = note ? `${input.reason}: ${note}` : input.reason;
      const balance = await this.ledger.apply(actor, {
        branchId,
        product,
        operation: 'mermar',
        quantity,
        reason,
      });
      await this.record(actor, branchId, 'stock_merma', 'inventario', product.id, null, {
        sucursalId: branchId,
        cantidad: quantity,
        motivo: reason,
      });
      return balance;
    });
  }
}

// Revisión de un ítem "En Revisión" (RF-088): vuelve al disponible o pasa a merma.
export class ResolveReview extends InventoryUseCase {
  async execute(
    context: SecurityContext,
    branchId: string,
    productId: string,
    input: { action: 'reingresar' | 'merma'; quantity: string; reason?: string | null },
  ): Promise<StockBalance> {
    return this.inBranch(context, ADJUST, branchId, async (actor) => {
      const product = await this.stockable(context, actor, productId, false);
      const quantity = normalizeQuantity(input.quantity);
      const reason =
        input.action === 'merma' ? assertReason(input.reason ?? '', 'El motivo de la merma') : null;
      const balance = await this.ledger.apply(actor, {
        branchId,
        product,
        operation: input.action === 'reingresar' ? 'reingresar' : 'mermarRevision',
        quantity,
        reason,
      });
      await this.record(actor, branchId, 'stock_revision', 'inventario', productId, null, {
        sucursalId: branchId,
        accion: input.action,
        cantidad: quantity,
        motivo: reason,
      });
      return balance;
    });
  }
}

export class ListMovements extends InventoryUseCase {
  async execute(context: SecurityContext, branchId: string): Promise<Movement[]> {
    return this.inBranch(context, ADJUST, branchId, (actor) =>
      this.deps.movements.list(actor.tenantId, branchId, MAX_MOVEMENTS),
    );
  }
}

export class ListBranchAlerts extends InventoryUseCase {
  async execute(context: SecurityContext, branchId: string): Promise<Alert[]> {
    return this.inBranch(context, ADJUST, branchId, (actor) =>
      this.deps.alerts.pending(actor.tenantId, branchId, 'AS'),
    );
  }
}

// La alerta de stock mínimo se resuelve sola al reponer; las demás se pueden descartar.
export class DismissAlert extends InventoryUseCase {
  async execute(context: SecurityContext, branchId: string, alertId: string): Promise<void> {
    await this.inBranch(context, ADJUST, branchId, async (actor) => {
      const alert = await this.deps.alerts.find(actor.tenantId, alertId);
      if (alert?.branchId !== branchId || alert.recipientRole !== 'AS') {
        return this.deps.access.notFound(context, 'alerta', alertId);
      }
      if (alert.resolvedAt !== null) {
        throw new ApplicationError('conflict', 'ALERTA_RESUELTA', 'La alerta ya está resuelta.');
      }
      if (alert.type === 'stock_minimo' || alert.severity === 'critica') {
        throw new DomainError(
          'ALERTA_NO_DESCARTABLE',
          'Esta alerta se resuelve sola cuando se corrige lo que la generó.',
        );
      }
      await this.deps.alerts.dismiss(actor.tenantId, alertId, actor.userId, actor.at);
    });
  }
}

export interface ComboStock {
  comboId: string;
  name: string;
  units: number;
  sellable: boolean;
}

// Disponibilidad de cada combo sobre el stock disponible real de la sucursal (RF-052, S-3).
export class ListComboAvailability extends InventoryUseCase {
  async execute(context: SecurityContext, branchId: string): Promise<ComboStock[]> {
    return this.inBranch(context, ADJUST, branchId, async (actor) => {
      const available = new Map(
        (await this.deps.stock.balances(actor.tenantId, branchId)).map((b) => [
          b.productId,
          b.available,
        ]),
      );
      const combos = await this.deps.catalog.combos(actor.tenantId);
      return combos
        .filter((combo) => combo.isActive)
        .map((combo) => {
          const sellable = combo.components.length > 0 && combo.components.every((c) => c.isActive);
          return {
            comboId: combo.id,
            name: combo.name,
            sellable,
            units: sellable
              ? comboAvailability(
                  combo.components.map((c) => ({
                    required: c.quantity,
                    available: available.get(c.productId) ?? '0.000',
                  })),
                )
              : 0,
          };
        });
    });
  }
}
