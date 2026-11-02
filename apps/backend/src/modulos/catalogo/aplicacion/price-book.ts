// Materialización de precios (T-077, T-078; RF-028, RF-032). Cada lista guarda el precio final de
// cada producto; se recalcula cuando cambia el costo, la categoría, la regla o el precio del combo,
// y cada cambio deja su fila en el historial.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import type { Product } from '../dominio/catalog.js';
import { computePrice } from '../dominio/price-rules.js';
import type {
  BranchPriceLists,
  CategoryRepository,
  ComboRepository,
  PriceChangeCause,
  PriceList,
  PriceListRepository,
  PriceRepository,
  ProductDependencyQuery,
  ProductRepository,
} from './ports.js';

export interface CatalogDependencies {
  uow: UnitOfWork;
  categories: CategoryRepository;
  products: ProductRepository;
  combos: ComboRepository;
  priceLists: PriceListRepository;
  prices: PriceRepository;
  branchLists: BranchPriceLists;
  productDependencies: ProductDependencyQuery;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
  ids: IdGenerator;
}

export interface Actor {
  tenantId: string;
  userId: string;
  at: Date;
}

export class PriceBook {
  constructor(private readonly deps: CatalogDependencies) {}

  // Recalcula los precios de las listas y productos indicados (todos, si se omiten).
  // Devuelve cuántos precios cambiaron.
  async recalculate(
    actor: Actor,
    scope: { listIds?: readonly string[]; productIds?: readonly string[] },
    cause: PriceChangeCause,
  ): Promise<number> {
    const { tenantId } = actor;
    const lists = (await this.deps.priceLists.list(tenantId, false)).filter(
      (list) => scope.listIds?.includes(list.id) ?? true,
    );
    const products = (
      scope.productIds
        ? await this.deps.products.findMany(tenantId, scope.productIds)
        : await this.deps.products.list(tenantId, false)
    ).filter((product) => product.isActive);
    if (lists.length === 0 || products.length === 0) return 0;

    const vatRates = new Map(
      (await this.deps.categories.list(tenantId, true)).map((c) => [c.id, c.vatRate]),
    );
    const current = new Map(
      (
        await this.deps.prices.current(tenantId, {
          listIds: lists.map((l) => l.id),
          productIds: products.map((p) => p.id),
        })
      ).map((row) => [`${row.listId}:${row.productId}`, row.price]),
    );

    let changed = 0;
    for (const list of lists) {
      for (const product of products) {
        const key = `${list.id}:${product.id}`;
        const target = targetPrice(list, product, vatRates);
        // Una lista de precio fijo conserva el precio cargado a mano.
        if (target === undefined) continue;
        const previous = current.has(key) ? (current.get(key) ?? null) : undefined;
        if (previous === target) continue;
        await this.deps.prices.save(
          tenantId,
          {
            listId: list.id,
            productId: product.id,
            price: target,
            previous: previous ?? null,
            cause,
          },
          actor.userId,
          actor.at,
        );
        changed++;
      }
    }
    return changed;
  }
}

// Precio que corresponde, o undefined si la lista no lo calcula (precio fijo de un simple).
function targetPrice(
  list: PriceList,
  product: Product,
  vatRates: ReadonlyMap<string, string>,
): string | null | undefined {
  // El combo tiene un precio único en todas las listas (RF-049).
  if (product.type === 'combo') return product.comboPrice;
  if (list.rule.type === 'fijo') return undefined;
  const vatRate = product.categoryId === null ? undefined : vatRates.get(product.categoryId);
  if (product.cost === null || product.categoryId === null || vatRate === undefined) return null;
  return computePrice(list.rule, { cost: product.cost, categoryId: product.categoryId, vatRate });
}

// Base de los casos de uso del catálogo: permiso, unidad de trabajo y auditoría comercial.
export abstract class CatalogUseCase {
  protected readonly priceBook: PriceBook;

  constructor(protected readonly deps: CatalogDependencies) {
    this.priceBook = new PriceBook(deps);
  }

  protected async inTenant<T>(
    context: SecurityContext,
    work: (actor: Actor) => Promise<T>,
  ): Promise<T> {
    await this.deps.access.check(context, 'catalogo.gestionar');
    const tenantId = this.deps.access.requireTenant(context);
    return this.deps.uow.run(
      () => work({ tenantId, userId: context.userId, at: this.deps.clock.now() }),
      { tenantId },
    );
  }

  protected async record(
    actor: Actor,
    action: string,
    entity: string,
    entityId: string,
    before: unknown,
    after: unknown,
    branchId: string | null = null,
  ) {
    await this.deps.audit.record({
      tenantId: actor.tenantId,
      branchId,
      userId: actor.userId,
      activeRole: 'AC',
      action,
      entity,
      entityId,
      before,
      after,
    });
  }
}
