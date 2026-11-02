// Arma el módulo de identidad con sus adaptadores. Lo usan la raíz de composición y las pruebas.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { AccessTokens } from '../../../compartido/aplicacion/access-tokens.js';
import type {
  CommercialAuditLog,
  TechnicalAuditLog,
} from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { EmailSender } from '../../../compartido/aplicacion/email-sender.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import {
  ConfirmEmail,
  RequestPasswordReset,
  ResendEmailValidation,
  ResetPassword,
} from '../aplicacion/account-recovery.js';
import {
  AuthorizeOperation,
  ConsumeAuthorization,
  GetAuthorization,
  SetAuthorizationPin,
} from '../aplicacion/authorizations.js';
import type { IdentityConfig } from '../aplicacion/config.js';
import { CredentialGuard } from '../aplicacion/credential-guard.js';
import type { SecretHasher } from '../aplicacion/ports.js';
import {
  GetCurrentSession,
  Login,
  Logout,
  RefreshSession,
  SelectActiveRole,
} from '../aplicacion/sessions.js';
import { cryptoOpaqueTokens } from './crypto.js';
import { identityRoutes, type IdentityUseCases } from './http.js';
import {
  PgAccessAttemptRepository,
  PgAuthorizationCredentialRepository,
  PgAuthorizationRepository,
  PgOneTimeTokenRepository,
  PgSessionRepository,
  PgUserRepository,
} from './postgres.js';

export interface IdentityModuleDependencies {
  db: PgDatabase;
  clock: Clock;
  ids: IdGenerator;
  hasher: SecretHasher;
  accessTokens: AccessTokens;
  email: EmailSender;
  technicalAudit: TechnicalAuditLog;
  commercialAudit: CommercialAuditLog;
  access: AccessControl;
  config: IdentityConfig;
}

export interface IdentityModule {
  routes: HttpRoute[];
  useCases: IdentityUseCases & { consumeAuthorization: ConsumeAuthorization };
}

export function createIdentityModule(deps: IdentityModuleDependencies): IdentityModule {
  const newId = () => deps.ids.next();
  const users = new PgUserRepository(deps.db);
  const sessions = new PgSessionRepository(deps.db);
  const guard = new CredentialGuard(
    new PgAccessAttemptRepository(deps.db, newId),
    deps.technicalAudit,
    deps.clock,
    deps.config.lockout,
  );

  const sessionDeps = {
    uow: deps.db,
    users,
    sessions,
    hasher: deps.hasher,
    opaqueTokens: cryptoOpaqueTokens,
    accessTokens: deps.accessTokens,
    guard,
    audit: deps.technicalAudit,
    clock: deps.clock,
    ids: deps.ids,
    config: deps.config,
  };
  const recoveryDeps = {
    uow: deps.db,
    users,
    sessions,
    oneTimeTokens: new PgOneTimeTokenRepository(deps.db),
    hasher: deps.hasher,
    opaqueTokens: cryptoOpaqueTokens,
    email: deps.email,
    audit: deps.technicalAudit,
    clock: deps.clock,
    ids: deps.ids,
    config: deps.config,
  };
  const authorizationDeps = {
    uow: deps.db,
    users,
    credentials: new PgAuthorizationCredentialRepository(deps.db, newId),
    authorizations: new PgAuthorizationRepository(deps.db),
    hasher: deps.hasher,
    guard,
    access: deps.access,
    commercialAudit: deps.commercialAudit,
    clock: deps.clock,
    ids: deps.ids,
  };

  const useCases = {
    login: new Login(sessionDeps),
    refresh: new RefreshSession(sessionDeps),
    logout: new Logout(sessionDeps),
    selectRole: new SelectActiveRole(sessionDeps),
    currentSession: new GetCurrentSession(sessionDeps),
    resendValidation: new ResendEmailValidation(recoveryDeps),
    confirmEmail: new ConfirmEmail(recoveryDeps),
    requestPasswordReset: new RequestPasswordReset(recoveryDeps),
    resetPassword: new ResetPassword(recoveryDeps),
    setPin: new SetAuthorizationPin(authorizationDeps),
    authorize: new AuthorizeOperation(authorizationDeps),
    getAuthorization: new GetAuthorization(authorizationDeps),
    consumeAuthorization: new ConsumeAuthorization(authorizationDeps),
  };
  return { routes: identityRoutes(useCases), useCases };
}
