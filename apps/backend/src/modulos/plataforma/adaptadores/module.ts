// Arma el módulo de plataforma con sus adaptadores. Lo usan la raíz de composición y las pruebas.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { TechnicalAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { PgEventOutbox } from '../../../compartido/adaptadores/outbox/pg-event-outbox.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import { CreateFirstTenantAdmin, CreatePlatformAdmin } from '../aplicacion/accounts.js';
import { GetTechnicalPanel, QueryTechnicalAudit } from '../aplicacion/monitoring.js';
import type {
  AccountRegistry,
  FiscalPendingQuery,
  TenantRoles,
  TenantSessions,
} from '../aplicacion/ports.js';
import {
  CloseTicket,
  CreateTicket,
  GetTenantTicket,
  GetTicketForSupport,
  ListAllTickets,
  ListTenantTickets,
  ReplyTicket,
} from '../aplicacion/support.js';
import {
  CloseTenant,
  CreateTenant,
  GetTenant,
  ListTenants,
  ReactivateTenant,
  SetTenantBillingModule,
  SuspendTenant,
  UpdateTenant,
} from '../aplicacion/tenants.js';
import { platformRoutes, type PlatformUseCases } from './http.js';
import {
  PgPlatformHealthQuery,
  PgTechnicalAuditQuery,
  PgTenantRepository,
  PgTicketRepository,
} from './postgres.js';

export interface PlatformModuleDependencies {
  db: PgDatabase;
  clock: Clock;
  ids: IdGenerator;
  access: AccessControl;
  technicalAudit: TechnicalAuditLog;
  fiscalPending: FiscalPendingQuery;
  // Los provee el módulo de identidad.
  accounts: AccountRegistry;
  tenantSessions: TenantSessions;
  tenantRoles: TenantRoles;
}

export interface PlatformModule {
  routes: HttpRoute[];
  useCases: PlatformUseCases;
  // Para otros módulos: nombre del comercio y si tiene el módulo de facturación.
  tenantDirectory: {
    find(tenantId: string): Promise<{ name: string; billingModule: boolean } | undefined>;
  };
}

export function createPlatformModule(deps: PlatformModuleDependencies): PlatformModule {
  const tenants = new PgTenantRepository(deps.db);
  const tenantDeps = {
    uow: deps.db,
    tenants,
    fiscalPending: deps.fiscalPending,
    sessions: deps.tenantSessions,
    outbox: new PgEventOutbox(deps.db, deps.clock, deps.ids),
    access: deps.access,
    audit: deps.technicalAudit,
    clock: deps.clock,
    ids: deps.ids,
  };
  const accountDeps = {
    accounts: deps.accounts,
    tenants,
    roles: deps.tenantRoles,
    access: deps.access,
  };
  const supportDeps = {
    uow: deps.db,
    tickets: new PgTicketRepository(deps.db),
    access: deps.access,
    clock: deps.clock,
    ids: deps.ids,
  };

  const useCases: PlatformUseCases = {
    createTenant: new CreateTenant(tenantDeps),
    listTenants: new ListTenants(tenantDeps),
    getTenant: new GetTenant(tenantDeps),
    updateTenant: new UpdateTenant(tenantDeps),
    suspendTenant: new SuspendTenant(tenantDeps),
    reactivateTenant: new ReactivateTenant(tenantDeps),
    closeTenant: new CloseTenant(tenantDeps),
    setBillingModule: new SetTenantBillingModule(tenantDeps),
    createPlatformAdmin: new CreatePlatformAdmin(accountDeps),
    createFirstTenantAdmin: new CreateFirstTenantAdmin(accountDeps),
    createTicket: new CreateTicket(supportDeps),
    listTenantTickets: new ListTenantTickets(supportDeps),
    getTenantTicket: new GetTenantTicket(supportDeps),
    listAllTickets: new ListAllTickets(supportDeps),
    getTicketForSupport: new GetTicketForSupport(supportDeps),
    replyTicket: new ReplyTicket(supportDeps),
    closeTicket: new CloseTicket(supportDeps),
    queryTechnicalAudit: new QueryTechnicalAudit(new PgTechnicalAuditQuery(deps.db), deps.access),
    technicalPanel: new GetTechnicalPanel(new PgPlatformHealthQuery(deps.db), deps.access),
  };
  return {
    routes: platformRoutes(useCases),
    useCases,
    tenantDirectory: {
      async find(tenantId) {
        const tenant = await tenants.findById(tenantId);
        return tenant ? { name: tenant.name, billingModule: tenant.billingModule } : undefined;
      },
    },
  };
}
