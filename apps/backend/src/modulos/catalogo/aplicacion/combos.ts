// Combos con sus componentes y su precio único (T-080, T-082; RF-049, RF-149).
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import { assertCatalogName, normalizeBarcode, type Product } from '../dominio/catalog.js';
import { assertComponents, type ComboComponent, comboSellable } from '../dominio/combos.js';
import { normalizePrice } from '../dominio/price-rules.js';
import type { ComponentRow } from './ports.js';
import type { Actor } from './price-book.js';
import { inactive, ProductUseCase } from './products.js';

export interface Combo {
  product: Product;
  components: ComponentRow[];
  sellable: boolean;
}

export interface ComboInput {
  name: string;
  barcode: string | null;
  price: string;
  components: ComboComponent[];
}

abstract class ComboUseCase extends ProductUseCase {
  protected async validComponents(actor: Actor, components: readonly ComboComponent[]) {
    const found = await this.deps.products.findMany(
      actor.tenantId,
      components.map((c) => c.productId),
    );
    return assertComponents(components, new Map(found.map((p) => [p.id, p])));
  }

  protected async load(actor: Actor, product: Product): Promise<Combo> {
    const components = await this.deps.combos.components(actor.tenantId, product.id);
    return {
      product,
      components,
      sellable: comboSellable(
        product,
        components.map((c) => c.productActive),
      ),
    };
  }
}

export class ListCombos extends ComboUseCase {
  async execute(context: SecurityContext, includeInactive = false): Promise<Combo[]> {
    return this.inTenant(context, async (actor) => {
      const combos = (await this.deps.products.list(actor.tenantId, includeInactive)).filter(
        (p) => p.type === 'combo',
      );
      const components = await this.deps.combos.components(actor.tenantId);
      return combos.map((product) => {
        const own = components.filter((c) => c.comboId === product.id);
        return {
          product,
          components: own,
          sellable: comboSellable(
            product,
            own.map((c) => c.productActive),
          ),
        };
      });
    });
  }
}

export class CreateCombo extends ComboUseCase {
  async execute(context: SecurityContext, input: ComboInput): Promise<Combo> {
    return this.inTenant(context, async (actor) => {
      const components = await this.validComponents(actor, input.components);
      const barcode = normalizeBarcode(input.barcode);
      await this.assertBarcodeFree(actor, barcode);
      const product: Product = {
        id: this.deps.ids.next(),
        tenantId: actor.tenantId,
        type: 'combo',
        name: assertCatalogName(input.name, 120, 'El nombre del combo'),
        barcode,
        categoryId: null,
        cost: null,
        comboPrice: normalizePrice(input.price, 'El precio del combo'),
        isActive: true,
        hasImage: false,
      };
      await this.deps.products.insert(product, actor.at);
      await this.deps.combos.replaceComponents(
        actor.tenantId,
        product.id,
        components,
        actor.userId,
        actor.at,
      );
      await this.priceBook.recalculate(actor, { productIds: [product.id] }, 'alta_producto');
      await this.record(actor, 'combo_alta', 'producto', product.id, null, {
        ...product,
        components,
      });
      return this.load(actor, product);
    });
  }
}

export class UpdateCombo extends ComboUseCase {
  async execute(
    context: SecurityContext,
    id: string,
    changes: Partial<ComboInput>,
  ): Promise<Combo> {
    return this.inTenant(context, async (actor) => {
      const current = await this.product(context, actor, id);
      if (current.type !== 'combo') {
        throw new DomainError('NO_ES_UN_COMBO', 'El producto no es un combo.');
      }
      if (!current.isActive) throw inactive('El combo está dado de baja.');
      const barcode =
        changes.barcode === undefined ? current.barcode : normalizeBarcode(changes.barcode);
      if (barcode !== current.barcode) await this.assertBarcodeFree(actor, barcode, id);
      const next: Product = {
        ...current,
        barcode,
        ...(changes.name === undefined
          ? {}
          : { name: assertCatalogName(changes.name, 120, 'El nombre del combo') }),
        ...(changes.price === undefined
          ? {}
          : { comboPrice: normalizePrice(changes.price, 'El precio del combo') }),
      };
      const before = await this.load(actor, current);
      await this.deps.products.update(next);
      if (changes.components !== undefined) {
        const components = await this.validComponents(actor, changes.components);
        await this.deps.combos.replaceComponents(
          actor.tenantId,
          id,
          components,
          actor.userId,
          actor.at,
        );
      }
      if (next.comboPrice !== current.comboPrice) {
        await this.priceBook.recalculate(actor, { productIds: [id] }, 'combo');
      }
      const after = await this.load(actor, next);
      await this.record(actor, 'combo_modificado', 'producto', id, before, after);
      return after;
    });
  }
}
