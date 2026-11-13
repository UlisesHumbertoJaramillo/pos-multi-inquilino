// Carga de precios desde Excel (T-294; RF-171, D-98). Cada fila indica la lista y el producto por
// código de barras. Solo se cargan precios en listas de precio fijo: en las otras el precio sale de
// su regla. Cada cambio queda en el historial, con la causa «manual», igual que la carga a mano.
import { DomainError } from '../../../compartido/dominio/errors.js';
import { normalizeBarcode } from '../dominio/catalog.js';
import { normalizePrice } from '../dominio/price-rules.js';
import type { CatalogDependencies } from './price-book.js';

export interface PriceImportRow {
  line: number;
  list: string;
  barcode: string;
  price: string;
}

export type PriceImportOutcome =
  | { line: number; key: string; outcome: 'creado' | 'actualizado' }
  | { line: number; key: string; outcome: 'error'; reason: string };

export class PriceImport {
  constructor(private readonly deps: CatalogDependencies) {}

  async importRows(
    actor: { tenantId: string; userId: string; at: Date },
    rows: readonly PriceImportRow[],
  ): Promise<PriceImportOutcome[]> {
    const lists = new Map(
      (await this.deps.priceLists.list(actor.tenantId, false)).map((l) => [
        l.name.trim().toLocaleLowerCase('es'),
        l,
      ]),
    );
    const products = new Map(
      (await this.deps.products.list(actor.tenantId, false))
        .filter((p) => p.barcode !== null)
        .map((p) => [p.barcode ?? '', p]),
    );
    const seen = new Set<string>();
    const outcomes: PriceImportOutcome[] = [];
    for (const row of rows) {
      const key = `${row.list.trim()} · ${row.barcode.trim()}`;
      try {
        const list = lists.get(row.list.trim().toLocaleLowerCase('es'));
        if (!list) {
          throw new DomainError(
            'LISTA_INEXISTENTE',
            `La lista «${row.list.trim()}» no existe o está dada de baja.`,
          );
        }
        if (list.rule.type !== 'fijo') {
          throw new DomainError(
            'PRECIO_CALCULADO',
            `La lista «${list.name}» calcula sus precios con su regla: solo se cargan precios en listas de precio fijo.`,
          );
        }
        const barcode = normalizeBarcode(row.barcode);
        const product = barcode === null ? undefined : products.get(barcode);
        if (!product) {
          throw new DomainError(
            'PRODUCTO_INEXISTENTE',
            'No hay un producto activo con ese código de barras.',
          );
        }
        if (product.type === 'combo') {
          throw new DomainError(
            'ES_UN_COMBO',
            'El precio de un combo es único y se modifica en el combo.',
          );
        }
        if (seen.has(`${list.id}:${product.id}`)) {
          throw new DomainError(
            'FILA_REPETIDA',
            'El producto ya tiene precio en otra fila de la misma lista.',
          );
        }
        seen.add(`${list.id}:${product.id}`);
        const price = normalizePrice(row.price);
        const [current] = await this.deps.prices.current(actor.tenantId, {
          listIds: [list.id],
          productIds: [product.id],
        });
        const previous = current?.price ?? null;
        if (previous !== price) {
          await this.deps.prices.save(
            actor.tenantId,
            { listId: list.id, productId: product.id, price, previous, cause: 'manual' },
            actor.userId,
            actor.at,
          );
        }
        outcomes.push({
          line: row.line,
          key,
          outcome: previous === null ? 'creado' : 'actualizado',
        });
      } catch (error: unknown) {
        if (!(error instanceof DomainError)) throw error;
        outcomes.push({ line: row.line, key, outcome: 'error', reason: error.message });
      }
    }
    return outcomes;
  }
}
