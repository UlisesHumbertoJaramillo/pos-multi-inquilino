// Arma el módulo de caja con sus adaptadores. Lo usan la raíz de composición y las pruebas.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import {
  type CashDependencies,
  CloseJourney,
  CloseOwnShift,
  ForceCloseShift,
  GetOwnShift,
  ListOpenShifts,
  ListRegisters,
  OpenShift,
  RecordCashIn,
  RecordWithdrawal,
} from '../aplicacion/cash.js';
import type { SalesInProgress, ShiftQuota, WithdrawalAuthorizations } from '../aplicacion/ports.js';
import { cashRoutes, type CashUseCases } from './http.js';
import { PgCashAlerts, PgCashRepository, PgCashSettings } from './postgres.js';

export interface CashModuleDependencies {
  db: PgDatabase;
  clock: Clock;
  ids: IdGenerator;
  access: AccessControl;
  commercialAudit: CommercialAuditLog;
  defaultTolerance: string;
  sales: SalesInProgress;
  quota: ShiftQuota;
  authorizations: WithdrawalAuthorizations;
}

export interface CashModule {
  routes: HttpRoute[];
  useCases: CashUseCases;
  // Para organización: turnos abiertos que impiden bajas (D-42).
  openShifts: PgCashRepository['countOpenShifts'];
}

// Hasta T-149 no hay ventas: ningún turno ni caja tiene ventas en curso.
export const noSalesInProgressYet: SalesInProgress = {
  forShift: () => Promise.resolve([]),
  forRegister: () => Promise.resolve([]),
  discardForShift: () => Promise.resolve(),
};

export function createCashModule(deps: CashModuleDependencies): CashModule {
  const cash = new PgCashRepository(deps.db);
  const dependencies: CashDependencies = {
    uow: deps.db,
    cash,
    settings: new PgCashSettings(deps.db, deps.defaultTolerance),
    alerts: new PgCashAlerts(deps.db),
    sales: deps.sales,
    quota: deps.quota,
    authorizations: deps.authorizations,
    access: deps.access,
    audit: deps.commercialAudit,
    clock: deps.clock,
    ids: deps.ids,
  };
  const useCases: CashUseCases = {
    listRegisters: new ListRegisters(dependencies),
    getOwnShift: new GetOwnShift(dependencies),
    openShift: new OpenShift(dependencies),
    recordCashIn: new RecordCashIn(dependencies),
    recordWithdrawal: new RecordWithdrawal(dependencies),
    closeOwnShift: new CloseOwnShift(dependencies),
    listOpenShifts: new ListOpenShifts(dependencies),
    forceCloseShift: new ForceCloseShift(dependencies),
    closeJourney: new CloseJourney(dependencies),
  };
  return {
    routes: cashRoutes(useCases),
    useCases,
    openShifts: (tenantId, filter) =>
      deps.db.run(() => cash.countOpenShifts(tenantId, filter), { tenantId }),
  };
}
