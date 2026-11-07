// Arma el módulo de devoluciones con sus adaptadores. Lo usan la raíz de composición y las pruebas.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { PgEventOutbox } from '../../../compartido/adaptadores/outbox/pg-event-outbox.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type { PaymentGateway } from '../../cobros/aplicacion/gateway.js';
import type {
  ReturnAuthorizations,
  ReturnCredit,
  ReturnSalesState,
  ReturnShifts,
  ReturnStock,
} from '../aplicacion/ports.js';
import {
  ConfirmReturn,
  FindTicket,
  QuoteReturn,
  type ReturnDependencies,
  VoidSale,
} from '../aplicacion/returns.js';
import { returnRoutes, type ReturnUseCases } from './http.js';
import { PgReturnRepository, PgReturnSettings, PgUncertainRefunds } from './postgres.js';

export interface ReturnsModuleDependencies {
  db: PgDatabase;
  clock: Clock;
  ids: IdGenerator;
  access: AccessControl;
  commercialAudit: CommercialAuditLog;
  defaultWindowDays: number;
  shifts: ReturnShifts;
  sales: ReturnSalesState;
  stock: ReturnStock;
  credit: ReturnCredit & { freeBalance(tenantId: string, customerId: string): Promise<string> };
  gateway: PaymentGateway;
  authorizations: ReturnAuthorizations;
}

export interface ReturnsModule {
  routes: HttpRoute[];
  useCases: ReturnUseCases;
}

export function createReturnsModule(deps: ReturnsModuleDependencies): ReturnsModule {
  const dependencies: ReturnDependencies = {
    uow: deps.db,
    returns: new PgReturnRepository(deps.db),
    settings: new PgReturnSettings(deps.db, deps.defaultWindowDays),
    shifts: deps.shifts,
    sales: deps.sales,
    stock: deps.stock,
    credit: deps.credit,
    gateway: deps.gateway,
    authorizations: deps.authorizations,
    uncertain: new PgUncertainRefunds(deps.db),
    outbox: new PgEventOutbox(deps.db, deps.clock, deps.ids),
    access: deps.access,
    audit: deps.commercialAudit,
    clock: deps.clock,
    ids: deps.ids,
  };
  const useCases: ReturnUseCases = {
    findTicket: new FindTicket(dependencies),
    quoteReturn: new QuoteReturn(dependencies),
    confirmReturn: new ConfirmReturn(dependencies),
    voidSale: new VoidSale(dependencies),
  };
  return { routes: returnRoutes(useCases), useCases };
}
