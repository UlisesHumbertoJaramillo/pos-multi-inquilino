// Arma el módulo de proveedores con sus adaptadores. Lo usan la raíz de composición y las pruebas.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type { CatalogGateway, StockIntake } from '../aplicacion/ports.js';
import {
  CreateSupplier,
  DeactivateSupplier,
  GetPurchase,
  GetSupplierStatement,
  ImportCatalog,
  ListPendingReceptions,
  ListPurchases,
  ListSuppliers,
  ReceivePurchase,
  RegisterPayment,
  RegisterPurchase,
  type SupplierDependencies,
  UpdateSupplier,
} from '../aplicacion/suppliers.js';
import { supplierRoutes, type SupplierUseCases } from './http.js';
import {
  PgImportLog,
  PgPaymentRepository,
  PgPurchaseRepository,
  PgSupplierBranches,
  PgSupplierRepository,
} from './postgres.js';

export interface SupplierModuleDependencies {
  db: PgDatabase;
  clock: Clock;
  ids: IdGenerator;
  access: AccessControl;
  commercialAudit: CommercialAuditLog;
  catalog: CatalogGateway;
  stock: StockIntake;
}

export interface SupplierModule {
  routes: HttpRoute[];
  useCases: SupplierUseCases;
  // Compras pendientes de un producto, para el control de bajas del catálogo (D-42).
  pendingPurchases(tenantId: string, productId: string): Promise<number>;
}

export function createSupplierModule(deps: SupplierModuleDependencies): SupplierModule {
  const purchases = new PgPurchaseRepository(deps.db);
  const suppliers: SupplierDependencies = {
    uow: deps.db,
    suppliers: new PgSupplierRepository(deps.db),
    imports: new PgImportLog(deps.db),
    purchases,
    payments: new PgPaymentRepository(deps.db),
    catalog: deps.catalog,
    stock: deps.stock,
    branches: new PgSupplierBranches(deps.db),
    access: deps.access,
    audit: deps.commercialAudit,
    clock: deps.clock,
    ids: deps.ids,
  };
  const useCases: SupplierUseCases = {
    listSuppliers: new ListSuppliers(suppliers),
    createSupplier: new CreateSupplier(suppliers),
    updateSupplier: new UpdateSupplier(suppliers),
    deactivateSupplier: new DeactivateSupplier(suppliers),
    getStatement: new GetSupplierStatement(suppliers),
    importCatalog: new ImportCatalog(suppliers),
    registerPayment: new RegisterPayment(suppliers),
    listPurchases: new ListPurchases(suppliers),
    getPurchase: new GetPurchase(suppliers),
    registerPurchase: new RegisterPurchase(suppliers),
    listPendingReceptions: new ListPendingReceptions(suppliers),
    receivePurchase: new ReceivePurchase(suppliers),
  };
  return {
    routes: supplierRoutes(useCases),
    useCases,
    pendingPurchases: (tenantId, productId) => purchases.pendingForProduct(tenantId, productId),
  };
}
