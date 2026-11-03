// Puertos de salida del módulo de catálogo. Los repositorios trabajan dentro de una unidad de
// trabajo con el comercio fijado (seguridad a nivel de fila) y además filtran por comercio.
import type { Category, ImageType, Product } from '../dominio/catalog.js';
import type { ComboComponent } from '../dominio/combos.js';
import type { PriceRule } from '../dominio/price-rules.js';

export interface CategoryRepository {
  list(tenantId: string, includeInactive: boolean): Promise<Category[]>;
  findById(tenantId: string, id: string): Promise<Category | undefined>;
  insert(category: Category, at: Date): Promise<void>;
  update(category: Category): Promise<void>;
  deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void>;
  hasActiveProducts(tenantId: string, id: string): Promise<boolean>;
}

export interface ProductRepository {
  list(tenantId: string, includeInactive: boolean): Promise<Product[]>;
  findById(tenantId: string, id: string): Promise<Product | undefined>;
  findMany(tenantId: string, ids: readonly string[]): Promise<Product[]>;
  // Otro producto activo con ese código (RF-131).
  barcodeInUse(tenantId: string, barcode: string, exceptId?: string): Promise<boolean>;
  insert(product: Product, at: Date): Promise<void>;
  update(product: Product): Promise<void>;
  deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void>;
  saveImage(
    tenantId: string,
    id: string,
    image: { type: ImageType; bytes: Uint8Array },
    by: string,
    at: Date,
  ): Promise<void>;
  findImage(
    tenantId: string,
    id: string,
  ): Promise<{ type: ImageType; bytes: Uint8Array } | undefined>;
}

export interface ComponentRow extends ComboComponent {
  comboId: string;
  productName: string;
  productActive: boolean;
}

export interface ComboRepository {
  // Componentes vigentes de todos los combos del comercio, o de uno.
  components(tenantId: string, comboId?: string): Promise<ComponentRow[]>;
  // Da de baja los componentes vigentes e inserta los nuevos.
  replaceComponents(
    tenantId: string,
    comboId: string,
    components: readonly ComboComponent[],
    by: string,
    at: Date,
  ): Promise<void>;
}

export interface PriceList {
  id: string;
  tenantId: string;
  name: string;
  rule: PriceRule;
  isActive: boolean;
}

export interface PriceListRepository {
  list(tenantId: string, includeInactive: boolean): Promise<PriceList[]>;
  findById(tenantId: string, id: string): Promise<PriceList | undefined>;
  insert(list: PriceList, at: Date): Promise<void>;
  update(list: PriceList): Promise<void>;
  deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void>;
}

export interface ListPrice {
  listId: string;
  productId: string;
  // Precio final con IVA, o null si el producto no tiene precio en esa lista.
  price: string | null;
}

export type PriceChangeCause =
  'alta_producto' | 'alta_lista' | 'costo' | 'categoria' | 'regla' | 'manual' | 'combo';

export interface PriceRepository {
  current(
    tenantId: string,
    scope: { listIds?: readonly string[]; productIds?: readonly string[] },
  ): Promise<ListPrice[]>;
  // Guarda el precio nuevo y su fila de historial (RF-032).
  save(
    tenantId: string,
    change: ListPrice & { previous: string | null; cause: PriceChangeCause },
    by: string,
    at: Date,
  ): Promise<void>;
}

export interface BranchPriceList {
  branchId: string;
  branchName: string;
  priceListId: string | null;
}

// Lista activa de cada sucursal (RF-119). La columna está en la tabla de sucursales.
export interface BranchPriceLists {
  list(tenantId: string): Promise<BranchPriceList[]>;
  find(tenantId: string, branchId: string): Promise<BranchPriceList | undefined>;
  assign(tenantId: string, branchId: string, priceListId: string): Promise<void>;
  countUsing(tenantId: string, priceListId: string): Promise<number>;
}

// Lo que impide dar de baja un producto (D-42): reservas, compras y transferencias pendientes.
// Lo aporta el inventario; las compras pendientes llegan en la Fase 6.
export interface ProductDependencyQuery {
  forProduct(
    tenantId: string,
    productId: string,
  ): Promise<{ reservations: number; pendingPurchases: number; pendingTransfers: number }>;
}
