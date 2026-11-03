// Arma el módulo de inventario con sus adaptadores. Lo usan la raíz de composición y las pruebas.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import { type InventoryDependencies, StockLedger } from '../aplicacion/ledger.js';
import {
  AdjustStock,
  DismissAlert,
  ListBranchAlerts,
  ListComboAvailability,
  ListMovements,
  ListStock,
  RecordWaste,
  ResolveReview,
  SetMinimum,
} from '../aplicacion/stock.js';
import {
  CancelTransfer,
  GetTransfer,
  IssueTransfer,
  ListTransferBranches,
  ListTransfers,
  ReceiveTransfer,
  RejectTransfer,
} from '../aplicacion/transfers.js';
import { PgInventoryDependencies } from './dependencies.js';
import { inventoryRoutes, type InventoryUseCases } from './http.js';
import {
  PgAlertRepository,
  PgBranchDirectory,
  PgMovementQuery,
  PgProductCatalog,
  PgStockRepository,
  PgTransferRepository,
} from './postgres.js';

export interface InventoryModuleDependencies {
  db: PgDatabase;
  clock: Clock;
  ids: IdGenerator;
  access: AccessControl;
  commercialAudit: CommercialAuditLog;
}

export interface InventoryModule {
  routes: HttpRoute[];
  useCases: InventoryUseCases;
  // Operaciones atómicas para ventas, compras y devoluciones (plan §2.7).
  ledger: StockLedger;
  dependencies: PgInventoryDependencies;
}

export function createInventoryModule(deps: InventoryModuleDependencies): InventoryModule {
  const inventory: InventoryDependencies = {
    uow: deps.db,
    stock: new PgStockRepository(deps.db),
    movements: new PgMovementQuery(deps.db),
    transfers: new PgTransferRepository(deps.db),
    alerts: new PgAlertRepository(deps.db),
    catalog: new PgProductCatalog(deps.db),
    branches: new PgBranchDirectory(deps.db),
    access: deps.access,
    audit: deps.commercialAudit,
    clock: deps.clock,
    ids: deps.ids,
  };
  const useCases: InventoryUseCases = {
    listStock: new ListStock(inventory),
    adjustStock: new AdjustStock(inventory),
    setMinimum: new SetMinimum(inventory),
    recordWaste: new RecordWaste(inventory),
    resolveReview: new ResolveReview(inventory),
    listMovements: new ListMovements(inventory),
    listBranchAlerts: new ListBranchAlerts(inventory),
    dismissAlert: new DismissAlert(inventory),
    listComboAvailability: new ListComboAvailability(inventory),
    listTransferBranches: new ListTransferBranches(inventory),
    listTransfers: new ListTransfers(inventory),
    getTransfer: new GetTransfer(inventory),
    issueTransfer: new IssueTransfer(inventory),
    receiveTransfer: new ReceiveTransfer(inventory),
    rejectTransfer: new RejectTransfer(inventory),
    cancelTransfer: new CancelTransfer(inventory),
  };
  return {
    routes: inventoryRoutes(useCases),
    useCases,
    ledger: new StockLedger(inventory.stock, inventory.alerts),
    dependencies: new PgInventoryDependencies(deps.db),
  };
}
