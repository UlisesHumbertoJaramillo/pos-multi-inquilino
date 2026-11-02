// Categorías, productos e imágenes (T-073 a T-075, T-078, T-082; RF-029, RF-130, RF-131,
// RF-149, RF-159).
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import {
  assertCatalogName,
  barcodeTaken,
  type Category,
  detectImageType,
  type ImageType,
  normalizeBarcode,
  normalizeCost,
  normalizeVatRate,
  type Product,
} from '../dominio/catalog.js';
import { comboSellable } from '../dominio/combos.js';
import { type Actor, CatalogUseCase } from './price-book.js';

export interface ListedProduct extends Product {
  // Se puede vender: activo y, si es combo, con todos sus componentes activos (RF-149).
  sellable: boolean;
}

export abstract class ProductUseCase extends CatalogUseCase {
  protected async category(context: SecurityContext, actor: Actor, id: string): Promise<Category> {
    const found = await this.deps.categories.findById(actor.tenantId, id);
    if (!found) return this.deps.access.notFound(context, 'categoria', id);
    return found;
  }

  protected async product(context: SecurityContext, actor: Actor, id: string): Promise<Product> {
    const found = await this.deps.products.findById(actor.tenantId, id);
    if (!found) return this.deps.access.notFound(context, 'producto', id);
    return found;
  }

  // Una categoría de otro comercio o dada de baja no se puede asignar.
  protected async activeCategory(actor: Actor, id: string): Promise<Category> {
    const found = await this.deps.categories.findById(actor.tenantId, id);
    if (!found?.isActive) {
      throw new DomainError('CATEGORIA_INVALIDA', 'La categoría no existe o está dada de baja.');
    }
    return found;
  }

  protected async assertBarcodeFree(actor: Actor, barcode: string | null, exceptId?: string) {
    if (
      barcode !== null &&
      (await this.deps.products.barcodeInUse(actor.tenantId, barcode, exceptId))
    ) {
      throw barcodeTaken();
    }
  }
}

export class ListCategories extends ProductUseCase {
  async execute(context: SecurityContext, includeInactive = false): Promise<Category[]> {
    return this.inTenant(context, (actor) =>
      this.deps.categories.list(actor.tenantId, includeInactive),
    );
  }
}

export class CreateCategory extends ProductUseCase {
  async execute(
    context: SecurityContext,
    input: { name: string; vatRate: string },
  ): Promise<Category> {
    return this.inTenant(context, async (actor) => {
      const category: Category = {
        id: this.deps.ids.next(),
        tenantId: actor.tenantId,
        name: assertCatalogName(input.name, 80, 'El nombre de la categoría'),
        vatRate: normalizeVatRate(input.vatRate),
        isActive: true,
      };
      await this.deps.categories.insert(category, actor.at);
      await this.record(actor, 'categoria_alta', 'categoria', category.id, null, category);
      return category;
    });
  }
}

export class UpdateCategory extends ProductUseCase {
  async execute(
    context: SecurityContext,
    id: string,
    changes: { name?: string; vatRate?: string },
  ): Promise<Category> {
    return this.inTenant(context, async (actor) => {
      const current = await this.category(context, actor, id);
      if (!current.isActive) throw inactive('La categoría está dada de baja.');
      const next: Category = {
        ...current,
        ...(changes.name === undefined
          ? {}
          : { name: assertCatalogName(changes.name, 80, 'El nombre de la categoría') }),
        ...(changes.vatRate === undefined ? {} : { vatRate: normalizeVatRate(changes.vatRate) }),
      };
      await this.deps.categories.update(next);
      // El IVA forma parte del precio final: cambia el precio de los productos de la categoría.
      if (next.vatRate !== current.vatRate) {
        const productIds = (await this.deps.products.list(actor.tenantId, false))
          .filter((p) => p.categoryId === id)
          .map((p) => p.id);
        if (productIds.length > 0) {
          await this.priceBook.recalculate(actor, { productIds }, 'categoria');
        }
      }
      await this.record(actor, 'categoria_modificada', 'categoria', id, current, next);
      return next;
    });
  }
}

export class DeactivateCategory extends ProductUseCase {
  async execute(context: SecurityContext, id: string): Promise<void> {
    await this.inTenant(context, async (actor) => {
      const current = await this.category(context, actor, id);
      if (!current.isActive) throw inactive('La categoría está dada de baja.');
      if (await this.deps.categories.hasActiveProducts(actor.tenantId, id)) {
        throw new DomainError(
          'CATEGORIA_CON_PRODUCTOS',
          'La categoría tiene productos activos: cambialos de categoría o dalos de baja primero.',
        );
      }
      await this.deps.categories.deactivate(actor.tenantId, id, actor.userId, actor.at);
      await this.record(actor, 'categoria_baja', 'categoria', id, current, null);
    });
  }
}

export class ListProducts extends ProductUseCase {
  async execute(context: SecurityContext, includeInactive = false): Promise<ListedProduct[]> {
    return this.inTenant(context, async (actor) => {
      const products = await this.deps.products.list(actor.tenantId, includeInactive);
      const components = await this.deps.combos.components(actor.tenantId);
      return products.map((product) => ({
        ...product,
        sellable:
          product.type === 'simple'
            ? product.isActive
            : comboSellable(
                product,
                components.filter((c) => c.comboId === product.id).map((c) => c.productActive),
              ),
      }));
    });
  }
}

export interface ProductInput {
  name: string;
  barcode: string | null;
  categoryId: string;
  cost: string;
}

export class CreateProduct extends ProductUseCase {
  async execute(context: SecurityContext, input: ProductInput): Promise<Product> {
    return this.inTenant(context, async (actor) => {
      await this.activeCategory(actor, input.categoryId);
      const barcode = normalizeBarcode(input.barcode);
      await this.assertBarcodeFree(actor, barcode);
      const product: Product = {
        id: this.deps.ids.next(),
        tenantId: actor.tenantId,
        type: 'simple',
        name: assertCatalogName(input.name, 120, 'El nombre del producto'),
        barcode,
        categoryId: input.categoryId,
        cost: normalizeCost(input.cost),
        comboPrice: null,
        isActive: true,
        hasImage: false,
      };
      await this.deps.products.insert(product, actor.at);
      await this.priceBook.recalculate(actor, { productIds: [product.id] }, 'alta_producto');
      await this.record(actor, 'producto_alta', 'producto', product.id, null, product);
      return product;
    });
  }
}

export class UpdateProduct extends ProductUseCase {
  async execute(
    context: SecurityContext,
    id: string,
    changes: Partial<ProductInput>,
  ): Promise<Product> {
    return this.inTenant(context, async (actor) => {
      const current = await this.product(context, actor, id);
      if (!current.isActive) throw inactive('El producto está dado de baja.');
      if (current.type === 'combo') {
        throw new DomainError('ES_UN_COMBO', 'Los combos se modifican desde la sección de combos.');
      }
      if (changes.categoryId !== undefined) await this.activeCategory(actor, changes.categoryId);
      const barcode =
        changes.barcode === undefined ? current.barcode : normalizeBarcode(changes.barcode);
      if (barcode !== current.barcode) await this.assertBarcodeFree(actor, barcode, id);
      const next: Product = {
        ...current,
        barcode,
        ...(changes.name === undefined
          ? {}
          : { name: assertCatalogName(changes.name, 120, 'El nombre del producto') }),
        ...(changes.categoryId === undefined ? {} : { categoryId: changes.categoryId }),
        ...(changes.cost === undefined ? {} : { cost: normalizeCost(changes.cost) }),
      };
      await this.deps.products.update(next);
      // Cambio de costo o de categoría: se recalculan las listas que dependen de ellos (RF-032).
      if (next.cost !== current.cost || next.categoryId !== current.categoryId) {
        await this.priceBook.recalculate(
          actor,
          { productIds: [id] },
          next.cost !== current.cost ? 'costo' : 'categoria',
        );
      }
      await this.record(actor, 'producto_modificado', 'producto', id, current, next);
      return next;
    });
  }
}

// También da de baja combos. Los combos que lo usan como componente dejan de venderse (RF-149).
export class DeactivateProduct extends ProductUseCase {
  async execute(context: SecurityContext, id: string): Promise<void> {
    await this.inTenant(context, async (actor) => {
      const current = await this.product(context, actor, id);
      if (!current.isActive) throw inactive('El producto está dado de baja.');
      const pending = await this.deps.productDependencies.forProduct(actor.tenantId, id);
      const blockers = [
        pending.reservations > 0 ? `${String(pending.reservations)} reserva(s)` : null,
        pending.pendingPurchases > 0
          ? `${String(pending.pendingPurchases)} compra(s) pendiente(s)`
          : null,
        pending.pendingTransfers > 0
          ? `${String(pending.pendingTransfers)} transferencia(s) pendiente(s)`
          : null,
      ].filter((blocker) => blocker !== null);
      if (blockers.length > 0) {
        throw new DomainError(
          'BAJA_CON_DEPENDENCIAS',
          `No se puede dar de baja el producto: tiene ${blockers.join(', ')}.`,
        );
      }
      await this.deps.products.deactivate(actor.tenantId, id, actor.userId, actor.at);
      await this.record(actor, 'producto_baja', 'producto', id, current, null);
    });
  }
}

export class SetProductImage extends ProductUseCase {
  async execute(context: SecurityContext, id: string, bytes: Uint8Array): Promise<void> {
    await this.inTenant(context, async (actor) => {
      const current = await this.product(context, actor, id);
      if (!current.isActive) throw inactive('El producto está dado de baja.');
      const type = detectImageType(bytes);
      await this.deps.products.saveImage(
        actor.tenantId,
        id,
        { type, bytes },
        actor.userId,
        actor.at,
      );
      await this.record(actor, 'producto_imagen', 'producto', id, null, {
        type,
        bytes: bytes.length,
      });
    });
  }
}

export class GetProductImage extends ProductUseCase {
  async execute(
    context: SecurityContext,
    id: string,
  ): Promise<{ type: ImageType; bytes: Uint8Array }> {
    return this.inTenant(context, async (actor) => {
      await this.product(context, actor, id);
      const image = await this.deps.products.findImage(actor.tenantId, id);
      if (!image) {
        throw new ApplicationError('not_found', 'SIN_IMAGEN', 'El producto no tiene imagen.');
      }
      return image;
    });
  }
}

export function inactive(message: string): ApplicationError {
  return new ApplicationError('conflict', 'YA_DADO_DE_BAJA', message);
}
