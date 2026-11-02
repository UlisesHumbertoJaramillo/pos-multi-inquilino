// Listas de precios, precios cargados a mano y lista activa de cada sucursal
// (T-077 a T-079, T-083; RF-028, RF-032, RF-033, RF-119).
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import { assertCatalogName } from '../dominio/catalog.js';
import { normalizePrice, normalizeRule, type PriceRule } from '../dominio/price-rules.js';
import type { BranchPriceList, PriceList } from './ports.js';
import { type Actor, CatalogUseCase } from './price-book.js';
import { inactive } from './products.js';

export interface PriceSheetRow {
  productId: string;
  name: string;
  barcode: string | null;
  type: 'simple' | 'combo';
  categoryName: string | null;
  price: string | null;
}

export interface PriceSheet {
  list: PriceList;
  rows: PriceSheetRow[];
}

abstract class PriceListUseCase extends CatalogUseCase {
  protected async priceList(context: SecurityContext, actor: Actor, id: string) {
    const found = await this.deps.priceLists.findById(actor.tenantId, id);
    if (!found) return this.deps.access.notFound(context, 'lista_precio', id);
    return found;
  }

  // Las categorías de una regla por grupo tienen que ser del comercio.
  protected async validRule(actor: Actor, rule: PriceRule): Promise<PriceRule> {
    const normalized = normalizeRule(rule);
    if (normalized.type === 'por_grupo') {
      const categories = new Set(
        (await this.deps.categories.list(actor.tenantId, false)).map((c) => c.id),
      );
      if (Object.keys(normalized.byCategory).some((id) => !categories.has(id))) {
        throw new DomainError(
          'CATEGORIA_INVALIDA',
          'Una categoría de la regla no existe o está dada de baja.',
        );
      }
    }
    return normalized;
  }
}

export class ListPriceLists extends PriceListUseCase {
  async execute(context: SecurityContext, includeInactive = false): Promise<PriceList[]> {
    return this.inTenant(context, (actor) =>
      this.deps.priceLists.list(actor.tenantId, includeInactive),
    );
  }
}

export class CreatePriceList extends PriceListUseCase {
  async execute(
    context: SecurityContext,
    input: { name: string; rule: PriceRule },
  ): Promise<PriceList> {
    return this.inTenant(context, async (actor) => {
      const list: PriceList = {
        id: this.deps.ids.next(),
        tenantId: actor.tenantId,
        name: assertCatalogName(input.name, 80, 'El nombre de la lista'),
        rule: await this.validRule(actor, input.rule),
        isActive: true,
      };
      await this.deps.priceLists.insert(list, actor.at);
      await this.priceBook.recalculate(actor, { listIds: [list.id] }, 'alta_lista');
      await this.record(actor, 'lista_alta', 'lista_precio', list.id, null, list);
      return list;
    });
  }
}

export class UpdatePriceList extends PriceListUseCase {
  async execute(
    context: SecurityContext,
    id: string,
    changes: { name?: string; rule?: PriceRule },
  ): Promise<PriceList> {
    return this.inTenant(context, async (actor) => {
      const current = await this.priceList(context, actor, id);
      if (!current.isActive) throw inactive('La lista está dada de baja.');
      const next: PriceList = {
        ...current,
        ...(changes.name === undefined
          ? {}
          : { name: assertCatalogName(changes.name, 80, 'El nombre de la lista') }),
        ...(changes.rule === undefined ? {} : { rule: await this.validRule(actor, changes.rule) }),
      };
      await this.deps.priceLists.update(next);
      // Cambio de regla: se recalculan todos los precios de la lista (RF-032).
      if (JSON.stringify(next.rule) !== JSON.stringify(current.rule)) {
        await this.priceBook.recalculate(actor, { listIds: [id] }, 'regla');
      }
      await this.record(actor, 'lista_modificada', 'lista_precio', id, current, next);
      return next;
    });
  }
}

export class DeactivatePriceList extends PriceListUseCase {
  async execute(context: SecurityContext, id: string): Promise<void> {
    await this.inTenant(context, async (actor) => {
      const current = await this.priceList(context, actor, id);
      if (!current.isActive) throw inactive('La lista está dada de baja.');
      const using = await this.deps.branchLists.countUsing(actor.tenantId, id);
      if (using > 0) {
        throw new DomainError(
          'LISTA_ASIGNADA',
          `La lista es la activa de ${String(using)} sucursal(es): asignales otra primero.`,
        );
      }
      await this.deps.priceLists.deactivate(actor.tenantId, id, actor.userId, actor.at);
      await this.record(actor, 'lista_baja', 'lista_precio', id, current, null);
    });
  }
}

// Precios de una lista, para consultarla e imprimirla (RF-033).
export class GetPriceSheet extends PriceListUseCase {
  async execute(context: SecurityContext, id: string): Promise<PriceSheet> {
    return this.inTenant(context, async (actor) => {
      const list = await this.priceList(context, actor, id);
      const [products, categories, prices] = [
        await this.deps.products.list(actor.tenantId, false),
        await this.deps.categories.list(actor.tenantId, true),
        await this.deps.prices.current(actor.tenantId, { listIds: [id] }),
      ];
      const categoryName = new Map(categories.map((c) => [c.id, c.name]));
      const price = new Map(prices.map((p) => [p.productId, p.price]));
      const rows = products
        .map((product) => ({
          productId: product.id,
          name: product.name,
          barcode: product.barcode,
          type: product.type,
          categoryName:
            product.categoryId === null ? null : (categoryName.get(product.categoryId) ?? null),
          price: price.get(product.id) ?? null,
        }))
        .sort(
          (a, b) =>
            (a.categoryName ?? '~').localeCompare(b.categoryName ?? '~', 'es') ||
            a.name.localeCompare(b.name, 'es'),
        );
      return { list, rows };
    });
  }
}

// En una lista de precio fijo, el AC carga el precio de cada producto (null lo quita).
export class SetManualPrice extends PriceListUseCase {
  async execute(
    context: SecurityContext,
    listId: string,
    productId: string,
    price: string | null,
  ): Promise<void> {
    await this.inTenant(context, async (actor) => {
      const list = await this.priceList(context, actor, listId);
      if (!list.isActive) throw inactive('La lista está dada de baja.');
      if (list.rule.type !== 'fijo') {
        throw new DomainError(
          'PRECIO_CALCULADO',
          'Esta lista calcula sus precios con su regla; solo se cargan a mano en una lista de precio fijo.',
        );
      }
      const product = await this.deps.products.findById(actor.tenantId, productId);
      if (!product) return this.deps.access.notFound(context, 'producto', productId);
      if (!product.isActive) throw inactive('El producto está dado de baja.');
      if (product.type === 'combo') {
        throw new DomainError(
          'ES_UN_COMBO',
          'El precio de un combo es único y se modifica en el combo.',
        );
      }
      const next = price === null ? null : normalizePrice(price);
      const [current] = await this.deps.prices.current(actor.tenantId, {
        listIds: [listId],
        productIds: [productId],
      });
      const previous = current?.price ?? null;
      if (current !== undefined && previous === next) return;
      await this.deps.prices.save(
        actor.tenantId,
        { listId, productId, price: next, previous, cause: 'manual' },
        actor.userId,
        actor.at,
      );
      await this.record(
        actor,
        'precio_manual',
        'precio_lista',
        `${listId}:${productId}`,
        { price: previous },
        { price: next },
      );
    });
  }
}

export class ListBranchPriceLists extends PriceListUseCase {
  async execute(context: SecurityContext): Promise<BranchPriceList[]> {
    return this.inTenant(context, (actor) => this.deps.branchLists.list(actor.tenantId));
  }
}

// Cada sucursal tiene una única lista activa, que usan todos sus POS (RF-119).
export class AssignBranchPriceList extends PriceListUseCase {
  async execute(
    context: SecurityContext,
    branchId: string,
    priceListId: string,
  ): Promise<BranchPriceList> {
    return this.inTenant(context, async (actor) => {
      const branch = await this.deps.branchLists.find(actor.tenantId, branchId);
      if (!branch) return this.deps.access.notFound(context, 'sucursal', branchId);
      const list = await this.deps.priceLists.findById(actor.tenantId, priceListId);
      if (!list?.isActive) {
        throw new DomainError('LISTA_INVALIDA', 'La lista no existe o está dada de baja.');
      }
      await this.deps.branchLists.assign(actor.tenantId, branchId, priceListId);
      const next = { ...branch, priceListId };
      await this.record(
        actor,
        'sucursal_lista_asignada',
        'sucursal',
        branchId,
        branch,
        next,
        branchId,
      );
      return next;
    });
  }
}
