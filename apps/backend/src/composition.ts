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
import type { HttpRoute } from './compartido/adaptadores/http/routes.js';
import type { FiscalPendingQuery } from './modulos/plataforma/aplicacion/ports.js';
import type { DependencyQuery } from './modulos/organizacion/aplicacion/ports.js';
import type { ProductDependencyQuery } from './modulos/catalogo/aplicacion/ports.js';
import { createCatalogModule, type CatalogModule } from './modulos/catalogo/adaptadores/module.js';
import { createQuotaModule, type QuotaModule } from './modulos/cuota/adaptadores/module.js';
import {
  createPromotionModule,
  type PromotionModule,
} from './modulos/promociones/adaptadores/module.js';
import {
  createSupplierModule,
  type SupplierModule,
} from './modulos/proveedores/adaptadores/module.js';
import {
  createInventoryModule,
  type InventoryModule,
} from './modulos/inventario/adaptadores/module.js';
import {
  createOrganizationModule,
  type OrganizationModule,
} from './modulos/organizacion/adaptadores/module.js';
import {
  noDependenciesYet,
  tenantSessionIdlePolicy,
} from './modulos/organizacion/adaptadores/policies.js';
import { noFiscalPendingYet } from './modulos/plataforma/adaptadores/fiscal-pending.js';
import {
  createPlatformModule,
  type PlatformModule,
} from './modulos/plataforma/adaptadores/module.js';

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
  // Para las pruebas: comprobantes fiscales pendientes simulados (hasta la Fase 12 no hay).
  fiscalPending?: FiscalPendingQuery;
  // Solo para las pruebas: rutas protegidas adicionales (por ejemplo, una que falla a propósito).
  extraRoutes?: HttpRoute[];
  // Para las pruebas: dependencias simuladas de sucursales, cajas, usuarios y productos.
  dependencies?: DependencyQuery;
  productDependencies?: ProductDependencyQuery;
}

export interface Api {
  app: Express;
  identity: IdentityModule;
  platform: PlatformModule;
  organization: OrganizationModule;
  catalog: CatalogModule;
  inventory: InventoryModule;
  suppliers: SupplierModule;
  promotions: PromotionModule;
  quotas: QuotaModule;
  routes: HttpRoute[];
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
    sessionPolicy: tenantSessionIdlePolicy(deps.db),
    config: {
      ...DEFAULT_IDENTITY_CONFIG,
      sessionIdleMs: config.sessionIdleMinutes * 60_000,
      appPublicUrl: config.appPublicUrl,
    },
  });

  const platform = createPlatformModule({
    db: deps.db,
    clock: deps.clock,
    ids: uuidGenerator,
    access,
    technicalAudit,
    fiscalPending: deps.fiscalPending ?? noFiscalPendingYet,
    accounts: identity.useCases.registerAccount,
    tenantSessions: identity.tenantSessions,
    tenantRoles: identity.tenantRoles,
  });

  const inventory = createInventoryModule({
    db: deps.db,
    clock: deps.clock,
    ids: uuidGenerator,
    access,
    commercialAudit,
  });
  // Bajas de sucursales (RF-025, RF-148): el stock y las transferencias los aporta el inventario;
  // turnos y ventas en curso siguen simulados hasta las Fases 9 y 10.
  const branchDependencies: DependencyQuery = {
    ...noDependenciesYet,
    forBranch: async (tenantId, branchId) => ({
      ...(await noDependenciesYet.forBranch(tenantId, branchId)),
      ...(await inventory.dependencies.forBranch(tenantId, branchId)),
    }),
  };

  const organization = createOrganizationModule({
    db: deps.db,
    clock: deps.clock,
    ids: uuidGenerator,
    access,
    commercialAudit,
    dependencies: deps.dependencies ?? branchDependencies,
    tenants: platform.tenantDirectory,
    users: identity.tenantUsers,
    accounts: identity.useCases.registerAccount,
  });

  const catalog = createCatalogModule({
    db: deps.db,
    clock: deps.clock,
    ids: uuidGenerator,
    access,
    commercialAudit,
    // Bajas de productos (D-42): reservas y transferencias del inventario, compras de proveedores.
    productDependencies: deps.productDependencies ?? {
      forProduct: async (tenantId, productId) => ({
        ...(await inventory.dependencies.forProduct(tenantId, productId)),
        pendingPurchases: await suppliers.pendingPurchases(tenantId, productId),
      }),
    },
  });

  const suppliers = createSupplierModule({
    db: deps.db,
    clock: deps.clock,
    ids: uuidGenerator,
    access,
    commercialAudit,
    catalog: catalog.costs,
    // La recepción de una compra ingresa lo recibido al stock disponible (D-25).
    stock: {
      receive: async (actor, branchId, product, quantity, reference) => {
        await inventory.ledger.apply(actor, {
          branchId,
          product,
          operation: 'ingresar',
          quantity,
          reference,
        });
      },
    },
  });

  const promotions = createPromotionModule({
    db: deps.db,
    clock: deps.clock,
    ids: uuidGenerator,
    access,
    commercialAudit,
  });

  const quotas = createQuotaModule({
    db: deps.db,
    clock: deps.clock,
    ids: uuidGenerator,
    access,
    commercialAudit,
    // Un descuento fuera de cuota consume una autorización por PIN de identidad (RF-066).
    authorizations: {
      consume: (input) => identity.useCases.consumeAuthorization.execute(input),
    },
  });

  const routes = [
    ...identity.routes,
    ...platform.routes,
    ...organization.routes,
    ...catalog.routes,
    ...inventory.routes,
    ...suppliers.routes,
    ...promotions.routes,
    ...quotas.routes,
    ...(deps.extraRoutes ?? []),
  ];
  const app = createApp({
    devRoutes: !config.production,
    logger: deps.logger,
    security: { allowedOrigins: config.frontendOrigins, hsts: config.production },
    accessTokens,
    sessionStatus: identity.sessionStatus,
    access,
    technicalAudit,
    routes,
    ...(deps.publicRateLimit ? { publicRateLimit: deps.publicRateLimit } : {}),
  });
  return {
    app,
    identity,
    platform,
    organization,
    catalog,
    inventory,
    suppliers,
    promotions,
    quotas,
    routes,
  };
}
