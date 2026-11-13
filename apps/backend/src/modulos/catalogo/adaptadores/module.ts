// Arma el módulo de catálogo con sus adaptadores. Lo usan la raíz de composición y las pruebas.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import { CreateCombo, ListCombos, UpdateCombo } from '../aplicacion/combos.js';
import { CatalogCosts } from '../aplicacion/costs.js';
import { PriceImport } from '../aplicacion/price-import.js';
import type { ProductDependencyQuery } from '../aplicacion/ports.js';
import type { CatalogDependencies } from '../aplicacion/price-book.js';
import {
  AssignBranchPriceList,
  CreatePriceList,
  DeactivatePriceList,
  GetPriceSheet,
  ListBranchPriceLists,
  ListPriceLists,
  SetManualPrice,
  UpdatePriceList,
} from '../aplicacion/price-lists.js';
import {
  CreateCategory,
  CreateProduct,
  DeactivateCategory,
  DeactivateProduct,
  GetProductImage,
  ListCategories,
  ListProducts,
  SetProductImage,
  UpdateCategory,
  UpdateProduct,
} from '../aplicacion/products.js';
import { catalogRoutes, type CatalogUseCases } from './http.js';
import {
  PgBranchPriceLists,
  PgCategoryRepository,
  PgComboRepository,
  PgPriceListRepository,
  PgPriceRepository,
  PgProductRepository,
} from './postgres.js';

export interface CatalogModuleDependencies {
  db: PgDatabase;
  clock: Clock;
  ids: IdGenerator;
  access: AccessControl;
  commercialAudit: CommercialAuditLog;
  productDependencies: ProductDependencyQuery;
}

export interface CatalogModule {
  routes: HttpRoute[];
  useCases: CatalogUseCases;
  // Costos e importación para el módulo de proveedores.
  costs: CatalogCosts;
  // Carga de precios desde Excel (RF-171).
  priceImport: PriceImport;
}

export function createCatalogModule(deps: CatalogModuleDependencies): CatalogModule {
  const catalog: CatalogDependencies = {
    uow: deps.db,
    categories: new PgCategoryRepository(deps.db),
    products: new PgProductRepository(deps.db),
    combos: new PgComboRepository(deps.db),
    priceLists: new PgPriceListRepository(deps.db),
    prices: new PgPriceRepository(deps.db),
    branchLists: new PgBranchPriceLists(deps.db),
    productDependencies: deps.productDependencies,
    access: deps.access,
    audit: deps.commercialAudit,
    clock: deps.clock,
    ids: deps.ids,
  };
  const useCases: CatalogUseCases = {
    listCategories: new ListCategories(catalog),
    createCategory: new CreateCategory(catalog),
    updateCategory: new UpdateCategory(catalog),
    deactivateCategory: new DeactivateCategory(catalog),
    listProducts: new ListProducts(catalog),
    createProduct: new CreateProduct(catalog),
    updateProduct: new UpdateProduct(catalog),
    deactivateProduct: new DeactivateProduct(catalog),
    setProductImage: new SetProductImage(catalog),
    getProductImage: new GetProductImage(catalog),
    listCombos: new ListCombos(catalog),
    createCombo: new CreateCombo(catalog),
    updateCombo: new UpdateCombo(catalog),
    listPriceLists: new ListPriceLists(catalog),
    createPriceList: new CreatePriceList(catalog),
    updatePriceList: new UpdatePriceList(catalog),
    deactivatePriceList: new DeactivatePriceList(catalog),
    getPriceSheet: new GetPriceSheet(catalog),
    setManualPrice: new SetManualPrice(catalog),
    listBranchPriceLists: new ListBranchPriceLists(catalog),
    assignBranchPriceList: new AssignBranchPriceList(catalog),
  };
  return {
    routes: catalogRoutes(useCases),
    useCases,
    costs: new CatalogCosts(catalog),
    priceImport: new PriceImport(catalog),
  };
}
