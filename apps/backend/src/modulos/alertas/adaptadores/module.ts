// Arma el módulo de alertas y tiempo real. Lo usan la raíz de composición, el worker y las pruebas.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { AccessTokens } from '../../../compartido/aplicacion/access-tokens.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { Logger } from '../../../compartido/aplicacion/logger.js';
import type { SessionStatus } from '../../../compartido/aplicacion/session-status.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import {
  type AlertDependencies,
  AlertReminders,
  AuthorizeRealtime,
  ListMyAlerts,
  SummarizeMyAlerts,
  ResolveAlert,
} from '../aplicacion/alerts.js';
import type { RealtimeFeed } from '../aplicacion/ports.js';
import { alertRoutes, type AlertUseCases } from './http.js';
import { PgAlertInbox, PgBranchLookup } from './postgres.js';
import { RealtimeGateway } from './realtime-gateway.js';

// Tiempos del gateway; las pruebas los acortan.
export interface RealtimeTimings {
  recheckMs?: number;
  authTimeoutMs?: number;
}

export interface AlertsModuleDependencies {
  db: PgDatabase;
  clock: Clock;
  access: AccessControl;
  commercialAudit: CommercialAuditLog;
  tokens: AccessTokens;
  sessions: SessionStatus;
  allowedOrigins: readonly string[];
  logger: Logger;
}

export interface AlertsModule {
  routes: HttpRoute[];
  useCases: AlertUseCases;
  reminders: AlertReminders;
  // Gateway en vivo sobre el servidor HTTP, con la fuente de avisos que corresponda al entorno.
  realtime(feed: RealtimeFeed, options?: RealtimeTimings): RealtimeGateway;
}

export function createAlertsModule(deps: AlertsModuleDependencies): AlertsModule {
  const dependencies: AlertDependencies = {
    uow: deps.db,
    alerts: new PgAlertInbox(deps.db),
    branches: new PgBranchLookup(deps.db),
    access: deps.access,
    audit: deps.commercialAudit,
    clock: deps.clock,
  };
  const useCases: AlertUseCases = {
    listMyAlerts: new ListMyAlerts(dependencies),
    summarizeMyAlerts: new SummarizeMyAlerts(dependencies),
    resolveAlert: new ResolveAlert(dependencies),
  };
  const authorize = new AuthorizeRealtime(dependencies);
  return {
    routes: alertRoutes(useCases),
    useCases,
    reminders: new AlertReminders(dependencies),
    realtime: (feed, options = {}) =>
      new RealtimeGateway({
        tokens: deps.tokens,
        sessions: deps.sessions,
        authorize,
        feed,
        allowedOrigins: deps.allowedOrigins,
        logger: deps.logger,
        ...(options.recheckMs === undefined ? {} : { recheckMs: options.recheckMs }),
        ...(options.authTimeoutMs === undefined ? {} : { authTimeoutMs: options.authTimeoutMs }),
      }),
  };
}
