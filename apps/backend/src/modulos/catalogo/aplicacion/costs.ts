// Costos del catálogo para el módulo de proveedores (T-106, T-107; RF-032, RF-035, RF-036).
// No verifica permisos ni abre transacciones: lo usa un caso de uso de proveedores que ya lo hizo,
// dentro de su propia unidad de trabajo, y que escribe la auditoría como una sola operación.
import { DomainError } from '../../../compartido/dominio/errors.js';
import {
  assertCatalogName,
  normalizeBarcode,
  normalizeCost,
  type Product,
} from '../dominio/catalog.js';
import { type Actor, type CatalogDependencies, PriceBook } from './price-book.js';

export interface ImportRow {
  line: number;
  barcode: string;
  name: string;
  cost: string;
  category: string;
}

export type ImportOutcome =
  | { line: number; barcode: string; outcome: 'creado' | 'actualizado'; productId: string }
  | { line: number; barcode: string; outcome: 'error'; reason: string };

export class CatalogCosts {
  private readonly priceBook: PriceBook;

  constructor(private readonly deps: CatalogDependencies) {
    this.priceBook = new PriceBook(deps);
  }

  products(tenantId: string, ids: readonly string[]): Promise<Product[]> {
    return this.deps.products.findMany(tenantId, ids);
  }

  // El costo de cada producto pasa a ser el último costo de compra (D-66) y se recalculan sus
  // precios. Devuelve cuántos precios cambiaron.
  async applyPurchaseCosts(
    actor: Actor,
    changes: readonly { productId: string; cost: string }[],
  ): Promise<number> {
    const products = new Map(
      (
        await this.deps.products.findMany(
          actor.tenantId,
          changes.map((c) => c.productId),
        )
      ).map((p) => [p.id, p]),
    );
    const changed: string[] = [];
    for (const change of changes) {
      const product = products.get(change.productId);
      const cost = normalizeCost(change.cost);
      if (!product || product.cost === cost) continue;
      await this.deps.products.update({ ...product, cost });
      changed.push(product.id);
    }
    if (changed.length === 0) return 0;
    return this.priceBook.recalculate(actor, { productIds: changed }, 'costo');
  }

  // Importación de catálogo (RF-035, D-49): identifica por código de barras, crea o actualiza
  // las filas válidas e informa las demás con su motivo. Recalcula una sola vez al final.
  async importRows(
    actor: Actor,
    rows: readonly ImportRow[],
  ): Promise<{ outcomes: ImportOutcome[]; recalculated: number }> {
    const products = await this.deps.products.list(actor.tenantId, false);
    const byBarcode = new Map(
      products.filter((p) => p.barcode !== null).map((p) => [p.barcode ?? '', p]),
    );
    const categories = new Map(
      (await this.deps.categories.list(actor.tenantId, false)).map((c) => [
        c.name.toLocaleLowerCase('es'),
        c,
      ]),
    );
    const seen = new Set<string>();
    const created: string[] = [];
    const updated: string[] = [];
    const outcomes: ImportOutcome[] = [];

    for (const row of rows) {
      try {
        const barcode = normalizeBarcode(row.barcode);
        if (barcode === null) {
          throw new DomainError('CODIGO_BARRAS_INVALIDO', 'Falta el código de barras.');
        }
        if (seen.has(barcode)) {
          throw new DomainError('FILA_REPETIDA', 'El código de barras ya apareció en otra fila.');
        }
        seen.add(barcode);
        const name = assertCatalogName(row.name, 120, 'El nombre del producto');
        const cost = normalizeCost(row.cost);
        const category = categories.get(row.category.trim().toLocaleLowerCase('es'));
        if (!category) {
          throw new DomainError(
            'CATEGORIA_INVALIDA',
            `La categoría «${row.category.trim()}» no existe o está dada de baja.`,
          );
        }
        const existing = byBarcode.get(barcode);
        if (existing?.type === 'combo') {
          throw new DomainError('ES_UN_COMBO', 'El código de barras es de un combo.');
        }
        if (existing) {
          const next: Product = { ...existing, name, cost, categoryId: category.id };
          await this.deps.products.update(next);
          updated.push(existing.id);
          outcomes.push({
            line: row.line,
            barcode,
            outcome: 'actualizado',
            productId: existing.id,
          });
        } else {
          const product: Product = {
            id: this.deps.ids.next(),
            tenantId: actor.tenantId,
            type: 'simple',
            name,
            barcode,
            categoryId: category.id,
            cost,
            comboPrice: null,
            isActive: true,
            hasImage: false,
          };
          await this.deps.products.insert(product, actor.at);
          byBarcode.set(barcode, product);
          created.push(product.id);
          outcomes.push({ line: row.line, barcode, outcome: 'creado', productId: product.id });
        }
      } catch (error: unknown) {
        if (!(error instanceof DomainError)) throw error;
        outcomes.push({
          line: row.line,
          barcode: row.barcode.trim(),
          outcome: 'error',
          reason: error.message,
        });
      }
    }

    let recalculated = 0;
    if (created.length > 0) {
      recalculated += await this.priceBook.recalculate(
        actor,
        { productIds: created },
        'alta_producto',
      );
    }
    if (updated.length > 0) {
      recalculated += await this.priceBook.recalculate(actor, { productIds: updated }, 'costo');
    }
    return { outcomes, recalculated };
  }
}
