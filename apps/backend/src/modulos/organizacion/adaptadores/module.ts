// Arma el módulo de organización con sus adaptadores. Lo usan la raíz de composición y las pruebas.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type {
  AccountRegistry,
  DependencyQuery,
  TenantDirectory,
  TenantUsers,
} from '../aplicacion/ports.js';
import {
  CreatePaymentMethod,
  DeactivatePaymentMethod,
  GetParameters,
  ListPaymentMethods,
  UpdateParameters,
  UpdatePaymentMethod,
} from '../aplicacion/settings.js';
import {
  GetPosShortcuts,
  GetShortcutSettings,
  ResetShortcuts,
  UpdateShortcuts,
} from '../aplicacion/shortcuts.js';
import {
  CreateBranch,
  CreateRegister,
  DeactivateBranch,
  DeactivateRegister,
  GetStructure,
  UpdateBranch,
  UpdateRegister,
} from '../aplicacion/structure.js';
import {
  ChangeUserRoles,
  CreateTenantUser,
  DeactivateTenantUser,
  ListTenantUsers,
} from '../aplicacion/users.js';
import { organizationRoutes, type OrganizationUseCases } from './http.js';
import {
  PgBranchRepository,
  PgParametersRepository,
  PgPaymentMethodRepository,
  PgRegisterRepository,
  PgShortcutRepository,
} from './postgres.js';

export interface OrganizationModuleDependencies {
  db: PgDatabase;
  clock: Clock;
  ids: IdGenerator;
  access: AccessControl;
  commercialAudit: CommercialAuditLog;
  dependencies: DependencyQuery;
  // Los proveen plataforma (tenants) e identidad (users, accounts).
  tenants: TenantDirectory;
  users: TenantUsers;
  accounts: AccountRegistry;
}

export interface OrganizationModule {
  routes: HttpRoute[];
  useCases: OrganizationUseCases;
}

export function createOrganizationModule(deps: OrganizationModuleDependencies): OrganizationModule {
  const branches = new PgBranchRepository(deps.db);
  const common = {
    uow: deps.db,
    access: deps.access,
    audit: deps.commercialAudit,
    clock: deps.clock,
  };
  const structureDeps = {
    ...common,
    branches,
    registers: new PgRegisterRepository(deps.db),
    dependencies: deps.dependencies,
    tenants: deps.tenants,
    ids: deps.ids,
  };
  const userDeps = {
    ...common,
    users: deps.users,
    accounts: deps.accounts,
    branches,
    dependencies: deps.dependencies,
  };
  const settingsDeps = {
    ...common,
    parameters: new PgParametersRepository(deps.db),
    paymentMethods: new PgPaymentMethodRepository(deps.db),
    tenants: deps.tenants,
    ids: deps.ids,
  };

  const shortcutDeps = { ...common, shortcuts: new PgShortcutRepository(deps.db) };

  const useCases: OrganizationUseCases = {
    getStructure: new GetStructure(structureDeps),
    createBranch: new CreateBranch(structureDeps),
    updateBranch: new UpdateBranch(structureDeps),
    deactivateBranch: new DeactivateBranch(structureDeps),
    createRegister: new CreateRegister(structureDeps),
    updateRegister: new UpdateRegister(structureDeps),
    deactivateRegister: new DeactivateRegister(structureDeps),
    listUsers: new ListTenantUsers(userDeps),
    createUser: new CreateTenantUser(userDeps),
    changeUserRoles: new ChangeUserRoles(userDeps),
    deactivateUser: new DeactivateTenantUser(userDeps),
    getParameters: new GetParameters(settingsDeps),
    updateParameters: new UpdateParameters(settingsDeps),
    listPaymentMethods: new ListPaymentMethods(settingsDeps),
    createPaymentMethod: new CreatePaymentMethod(settingsDeps),
    updatePaymentMethod: new UpdatePaymentMethod(settingsDeps),
    deactivatePaymentMethod: new DeactivatePaymentMethod(settingsDeps),
    getPosShortcuts: new GetPosShortcuts(shortcutDeps),
    getShortcutSettings: new GetShortcutSettings(shortcutDeps),
    updateShortcuts: new UpdateShortcuts(shortcutDeps),
    resetShortcuts: new ResetShortcuts(shortcutDeps),
  };
  return { routes: organizationRoutes(useCases), useCases };
}
