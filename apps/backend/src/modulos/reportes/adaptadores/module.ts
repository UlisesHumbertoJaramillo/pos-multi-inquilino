// Arma el módulo de reportes con sus adaptadores. Lo usan la raíz de composición y las pruebas.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import {
  GetBranchDashboard,
  GetDailyReport,
  GetStrategicDashboard,
  GetTicket,
  QueryCommercialAudit,
  type ReportDependencies,
} from '../aplicacion/reports.js';
import { reportRoutes, type ReportUseCases } from './http.js';
import { PgAuditReader, PgReportReader } from './postgres.js';

export interface ReportsModuleDependencies {
  db: PgDatabase;
  clock: Clock;
  access: AccessControl;
}

export interface ReportsModule {
  routes: HttpRoute[];
  useCases: ReportUseCases;
}

export function createReportsModule(deps: ReportsModuleDependencies): ReportsModule {
  const dependencies: ReportDependencies = {
    uow: deps.db,
    reports: new PgReportReader(deps.db),
    audit: new PgAuditReader(deps.db),
    access: deps.access,
    clock: deps.clock,
  };
  const useCases: ReportUseCases = {
    getTicket: new GetTicket(dependencies),
    getDailyReport: new GetDailyReport(dependencies),
    getStrategicDashboard: new GetStrategicDashboard(dependencies),
    getBranchDashboard: new GetBranchDashboard(dependencies),
    queryCommercialAudit: new QueryCommercialAudit(dependencies),
  };
  return { routes: reportRoutes(useCases), useCases };
}
