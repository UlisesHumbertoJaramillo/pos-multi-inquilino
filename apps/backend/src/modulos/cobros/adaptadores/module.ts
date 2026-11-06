// Arma el módulo de cobros con sus adaptadores. Lo usan la raíz de composición, el worker y las
// pruebas.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { JobHandler } from '../../../compartido/aplicacion/job-scheduler.js';
import { PgJobScheduler } from '../../../compartido/adaptadores/jobs/pg-job-scheduler.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import {
  COLLECTION_VERIFICATION_JOB,
  CollectAccount,
  CollectionVerification,
  type CollectionDependencies,
  ListPendingCollections,
  ResolveCollection,
} from '../aplicacion/collections.js';
import {
  CreateCustomer,
  CustomerCredit,
  type CustomerDependencies,
  DeactivateCustomer,
  ListCustomers,
  SetCreditLimit,
  UpdateCustomer,
} from '../aplicacion/customers.js';
import type { PaymentGateway, RefundAlerts } from '../aplicacion/gateway.js';
import type {
  CollectionAuthorizations,
  CollectionMethods,
  CollectionShifts,
} from '../aplicacion/ports.js';
import { GatewaySimulator, unavailableGateway } from './gateway-simulator.js';
import { collectionRoutes, type CollectionUseCases, simulatorRoutes } from './http.js';
import {
  PgCollectionRepository,
  PgCustomerRepository,
  PgPaymentMethods,
  PgRefundAlerts,
} from './postgres.js';

export interface CollectionsModuleDependencies {
  db: PgDatabase;
  clock: Clock;
  ids: IdGenerator;
  access: AccessControl;
  commercialAudit: CommercialAuditLog;
  production: boolean;
  shifts: CollectionShifts;
  authorizations: CollectionAuthorizations;
}

export interface CollectionsModule {
  routes: HttpRoute[];
  useCases: CollectionUseCases;
  // Para ventas: crédito del cliente, medios de pago, pasarela y alertas.
  credit: CustomerCredit;
  methods: CollectionMethods;
  gateway: PaymentGateway;
  alerts: RefundAlerts;
  verification: CollectionVerification;
  jobHandlers: Record<string, JobHandler>;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

export function createCollectionsModule(deps: CollectionsModuleDependencies): CollectionsModule {
  const customers = new PgCustomerRepository(deps.db);
  const methods = new PgPaymentMethods(deps.db);
  const alerts = new PgRefundAlerts(deps.db);
  const simulator = deps.production ? null : new GatewaySimulator(deps.db, deps.clock);
  const gateway = simulator ?? unavailableGateway;
  const base: CustomerDependencies = {
    uow: deps.db,
    customers,
    access: deps.access,
    audit: deps.commercialAudit,
    clock: deps.clock,
    ids: deps.ids,
  };
  const collecting: CollectionDependencies = {
    ...base,
    collections: new PgCollectionRepository(deps.db),
    methods,
    shifts: deps.shifts,
    gateway,
    alerts,
    authorizations: deps.authorizations,
    jobs: new PgJobScheduler(deps.db, deps.clock, deps.ids),
  };
  const useCases: CollectionUseCases = {
    listCustomers: new ListCustomers(base),
    createCustomer: new CreateCustomer(base),
    updateCustomer: new UpdateCustomer(base),
    setCreditLimit: new SetCreditLimit(base),
    deactivateCustomer: new DeactivateCustomer(base),
    collectAccount: new CollectAccount(collecting),
    listPendingCollections: new ListPendingCollections(collecting),
    resolveCollection: new ResolveCollection(collecting),
  };
  const verification = new CollectionVerification(collecting);
  return {
    routes: [
      ...collectionRoutes(useCases),
      ...(simulator ? simulatorRoutes(simulator, deps.access) : []),
    ],
    useCases,
    credit: new CustomerCredit(base),
    methods,
    gateway,
    alerts,
    verification,
    jobHandlers: {
      [COLLECTION_VERIFICATION_JOB]: (job) =>
        verification.verify(text(job.payload.tenantId), text(job.payload.paymentId)),
    },
  };
}
