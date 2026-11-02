// Raíz de composición de la API: arma adaptadores, módulos y rutas desde la configuración.
// Falla al arrancar si la configuración no es segura para el entorno (Const. 17).
import type { Express } from 'express';
import { createApp } from './app.js';
import { AccessControl } from './compartido/aplicacion/access-control.js';
import type { Clock } from './compartido/aplicacion/clock.js';
import type { Logger } from './compartido/aplicacion/logger.js';
import {
  PgCommercialAuditLog,
  PgResourceOwnership,
  PgTechnicalAuditLog,
} from './compartido/adaptadores/audit/pg-audit-logs.js';
import { JoseAccessTokens } from './compartido/adaptadores/auth/jose-access-tokens.js';
import { createEmailSender } from './compartido/adaptadores/email/console-email-sender.js';
import { uuidGenerator } from './compartido/adaptadores/id/uuid-generator.js';
import type { PgDatabase } from './compartido/adaptadores/postgres/pg-database.js';
import { DEFAULT_IDENTITY_CONFIG } from './modulos/identidad/aplicacion/config.js';
import type { SecretHasher } from './modulos/identidad/aplicacion/ports.js';
import { Argon2SecretHasher } from './modulos/identidad/adaptadores/crypto.js';
import {
  createIdentityModule,
  type IdentityModule,
} from './modulos/identidad/adaptadores/module.js';
import type { EmailSender } from './compartido/aplicacion/email-sender.js';

export interface ApiConfig {
  production: boolean;
  frontendOrigins: string[];
  authTokenSecret: string;
  emailAdapter: string;
  appPublicUrl: string;
  sessionIdleMinutes: number;
}

export function apiConfigFromEnv(env: NodeJS.ProcessEnv): ApiConfig {
  const authTokenSecret = env.AUTH_TOKEN_SECRET;
  if (!authTokenSecret) throw new Error('Falta AUTH_TOKEN_SECRET. Corré `npm run db:setup`.');
  return {
    production: env.NODE_ENV === 'production',
    frontendOrigins: (env.FRONTEND_ORIGIN ?? 'https://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    authTokenSecret,
    emailAdapter: env.EMAIL_ADAPTER ?? 'console',
    appPublicUrl: env.APP_PUBLIC_URL ?? 'https://localhost:5173',
    sessionIdleMinutes: Number(env.SESSION_IDLE_MINUTES ?? '30'),
  };
}

export interface ApiDependencies {
  db: PgDatabase;
  clock: Clock;
  logger: Logger;
  // Opcionales para las pruebas: un hash más liviano o un correo en memoria.
  hasher?: SecretHasher;
  email?: EmailSender;
  publicRateLimit?: { windowMs: number; limit: number };
}

export interface Api {
  app: Express;
  identity: IdentityModule;
}

export function createApi(config: ApiConfig, deps: ApiDependencies): Api {
  const email =
    deps.email ??
    createEmailSender({ adapter: config.emailAdapter, production: config.production });
  const accessTokens = new JoseAccessTokens(config.authTokenSecret, deps.clock);
  const technicalAudit = new PgTechnicalAuditLog(deps.db, deps.clock, uuidGenerator);
  const commercialAudit = new PgCommercialAuditLog(deps.db, deps.clock, uuidGenerator);
  const access = new AccessControl(technicalAudit, new PgResourceOwnership(deps.db));

  const identity = createIdentityModule({
    db: deps.db,
    clock: deps.clock,
    ids: uuidGenerator,
    hasher: deps.hasher ?? new Argon2SecretHasher(),
    accessTokens,
    email,
    technicalAudit,
    commercialAudit,
    access,
    config: {
      ...DEFAULT_IDENTITY_CONFIG,
      sessionIdleMs: config.sessionIdleMinutes * 60_000,
      appPublicUrl: config.appPublicUrl,
    },
  });

  const app = createApp({
    devRoutes: !config.production,
    logger: deps.logger,
    security: { allowedOrigins: config.frontendOrigins, hsts: config.production },
    accessTokens,
    routes: identity.routes,
    ...(deps.publicRateLimit ? { publicRateLimit: deps.publicRateLimit } : {}),
  });
  return { app, identity };
}
