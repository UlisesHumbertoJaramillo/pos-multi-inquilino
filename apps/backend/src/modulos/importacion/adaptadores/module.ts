// Arma el módulo de carga desde Excel. Las filas las procesan los módulos dueños de cada dato:
// catálogo (productos y precios) y proveedores.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import { GetTemplate, type ImportDependencies, RunImport } from '../aplicacion/imports.js';
import type { PriceRows, ProductRows, SupplierRows } from '../aplicacion/ports.js';
import { importRoutes, type ImportUseCases } from './http.js';
import { XlsxSpreadsheet } from './xlsx.js';

export interface ImportModuleDependencies {
  db: PgDatabase;
  clock: Clock;
  ids: IdGenerator;
  access: AccessControl;
  commercialAudit: CommercialAuditLog;
  products: ProductRows;
  suppliers: SupplierRows;
  prices: PriceRows;
}

export interface ImportModule {
  routes: HttpRoute[];
  useCases: ImportUseCases;
}

export function createImportModule(deps: ImportModuleDependencies): ImportModule {
  const spreadsheet = new XlsxSpreadsheet();
  const dependencies: ImportDependencies = {
    uow: deps.db,
    reader: spreadsheet,
    writer: spreadsheet,
    products: deps.products,
    suppliers: deps.suppliers,
    prices: deps.prices,
    access: deps.access,
    audit: deps.commercialAudit,
    clock: deps.clock,
    ids: deps.ids,
  };
  const useCases: ImportUseCases = {
    runImport: new RunImport(dependencies),
    getTemplate: new GetTemplate(dependencies),
  };
  return { routes: importRoutes(useCases), useCases };
}
