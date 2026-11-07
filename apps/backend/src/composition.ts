// Raíz de composición de la API: arma adaptadores, módulos y rutas desde la configuración.
// Falla al arrancar si la configuración no es segura para el entorno (Const. 17).
import { createHash } from 'node:crypto';
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
import { type CashModule, createCashModule } from './modulos/caja/adaptadores/module.js';
import type { SalesInProgress } from './modulos/caja/aplicacion/ports.js';
import { createSalesModule, type SalesModule } from './modulos/ventas/adaptadores/module.js';
import {
  type CollectionsModule,
  createCollectionsModule,
} from './modulos/cobros/adaptadores/module.js';
import { DomainError } from './compartido/dominio/errors.js';
import { createFiscalModule, type FiscalModule } from './modulos/fiscal/adaptadores/module.js';
import {
  createReturnsModule,
  type ReturnsModule,
} from './modulos/devoluciones/adaptadores/module.js';
import { type AlertsModule, createAlertsModule } from './modulos/alertas/adaptadores/module.js';
import { createReportsModule, type ReportsModule } from './modulos/reportes/adaptadores/module.js';
import { DEFAULT_PARAMETERS } from './modulos/organizacion/dominio/parameters.js';
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
  // Clave maestra de la credencial fiscal (AD-25).
  fiscalMasterKey: Buffer;
}

// En producción es obligatoria; en desarrollo se deriva del secreto local.
function fiscalKeyFromEnv(env: NodeJS.ProcessEnv, authTokenSecret: string): Buffer {
  const value = env.FISCAL_MASTER_KEY;
  if (value) return Buffer.from(value, 'base64url');
  if (env.NODE_ENV === 'production') throw new Error('Falta FISCAL_MASTER_KEY.');
  return createHash('sha256').update(`fiscal:${authTokenSecret}`).digest();
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
    fiscalMasterKey: fiscalKeyFromEnv(env, authTokenSecret),
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
  // Para las pruebas: ventas en curso simuladas (hasta T-149 no hay ventas).
  salesInProgress?: SalesInProgress;
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
  cash: CashModule;
  collections: CollectionsModule;
  sales: SalesModule;
  fiscal: FiscalModule;
  returns: ReturnsModule;
  alerts: AlertsModule;
  reports: ReportsModule;
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
    // No se cierra sesión con un turno abierto o ventas en curso (RF-080). Caja y ventas se arman
    // más abajo: se usan recién al cerrar sesión.
    // El bloqueo de un PIN alerta al AC (RF-145, T-209).
    pinLockAlert: {
      raise: (tenantId, authorizerId, at) =>
        deps.db.query(
          `INSERT INTO alerta (id, tenant_id, destinatario_rol, tipo, severidad, referencia,
             detalle, creada_en)
           VALUES (gen_random_uuid(), $1, 'AC', 'pin_bloqueado', 'advertencia', $2, '{}', $3)`,
          [tenantId, authorizerId, at],
        ),
    },
    logoutGuard: {
      pending: async (tenantId, userId) => ({
        openShift: await cash.hasOpenShift(tenantId, userId),
        sales: (
          await deps.db.run(() => sales.maintenance.inProgressOfSeller(tenantId, userId), {
            tenantId,
          })
        ).map((s) => s.label),
      }),
    },
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
    // Comprobantes sin regularizar (T-205); el módulo fiscal se arma más abajo.
    fiscalPending: deps.fiscalPending ?? { pendingFor: (id) => fiscal.queue.pendingFor(id) },
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
  // Bajas de sucursales, cajas y usuarios (RF-025, RF-148, D-42): el stock y las transferencias
  // los aporta el inventario y los turnos abiertos, la caja; las ventas en curso siguen simuladas
  // hasta la Fase 10. El módulo de caja se arma más abajo: se usa recién al dar de baja.
  const branchDependencies: DependencyQuery = {
    forBranch: async (tenantId, branchId) => ({
      ...(await noDependenciesYet.forBranch(tenantId, branchId)),
      ...(await inventory.dependencies.forBranch(tenantId, branchId)),
      openShifts: await cash.openShifts(tenantId, { branchId }),
      carts: await sales.inProgress(tenantId, { branchId }),
    }),
    forRegister: async (tenantId, registerId) => ({
      ...(await noDependenciesYet.forRegister(tenantId, registerId)),
      openShifts: await cash.openShifts(tenantId, { registerId }),
      carts: await sales.inProgress(tenantId, { registerId }),
    }),
    forUser: async (tenantId, userId) => ({
      ...(await noDependenciesYet.forUser(tenantId, userId)),
      openShifts: await cash.openShifts(tenantId, { userId }),
      carts: await sales.inProgress(tenantId, { userId }),
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

  const cash = createCashModule({
    db: deps.db,
    clock: deps.clock,
    ids: uuidGenerator,
    access,
    commercialAudit,
    defaultTolerance: DEFAULT_PARAMETERS.cashCountTolerance,
    // Ventas en curso reales (T-149); las pruebas pueden simularlas.
    // Un cobro de cuenta corriente sin resultado retiene el turno igual que una venta (D-86).
    sales: deps.salesInProgress ?? {
      forShift: async (tenantId, shiftId) => [
        ...(await sales.maintenance.inProgressOfShift(tenantId, shiftId)),
        ...(await collections.verification.pendingOfShift(tenantId, shiftId)),
      ],
      forRegister: (tenantId, registerId) =>
        sales.maintenance.inProgressOfRegister(tenantId, registerId),
      discardForShift: async (actor, shiftId) => {
        const pending = await collections.verification.pendingOfShift(actor.tenantId, shiftId);
        if (pending.length > 0) {
          throw new DomainError(
            'PAGOS_POR_REVERTIR',
            'El turno tiene un cobro de cuenta corriente sin resultado: resolvelo antes de cerrarlo.',
          );
        }
        await sales.maintenance.discardForShift({ ...actor, role: 'AS' }, shiftId);
      },
    },
    // El primer turno de cada fecha de jornada restablece la cuota del VO (RF-067).
    quota: quotas.discounts,
    // Un retiro consume una autorización por PIN de identidad (RF-092).
    authorizations: {
      consume: (input) => identity.useCases.consumeAuthorization.execute(input),
    },
  });

  const collections = createCollectionsModule({
    db: deps.db,
    clock: deps.clock,
    ids: uuidGenerator,
    access,
    commercialAudit,
    production: config.production,
    shifts: cash.sales,
    // Resolver a mano un cobro por verificar consume una autorización por PIN (RF-126).
    authorizations: {
      consume: (input) => identity.useCases.consumeAuthorization.execute(input),
    },
  });

  const sales = createSalesModule({
    db: deps.db,
    clock: deps.clock,
    ids: uuidGenerator,
    access,
    commercialAudit,
    defaults: {
      cartIdleMinutes: DEFAULT_PARAMETERS.cartIdleMinutes,
      billingPolicy: DEFAULT_PARAMETERS.billingPolicy,
    },
    // Las promociones fijadas en un carrito se mantienen aunque venzan o se den de baja (RF-143).
    promotions: { all: (tenantId) => promotions.promotions.list(tenantId, true) },
    stock: {
      apply: async (actor, change) => {
        await inventory.ledger.apply(actor, change);
      },
    },
    shifts: cash.sales,
    cash: cash.sales,
    quota: {
      check: (actor, input) => quotas.discounts.check(actor, input),
      consume: async (actor, input) => {
        await quotas.discounts.applyDiscount(actor, input);
      },
    },
    // Descuentos, excesos de crédito y pagos por verificar consumen un PIN (RF-066, RF-074, RF-126).
    authorizations: {
      consume: (input) => identity.useCases.consumeAuthorization.execute(input),
    },
    customers: collections.credit,
    gateway: collections.gateway,
    alerts: collections.alerts,
  });

  const fiscal = createFiscalModule({
    db: deps.db,
    clock: deps.clock,
    ids: uuidGenerator,
    access,
    commercialAudit,
    production: config.production,
    masterKey: config.fiscalMasterKey,
    defaults: {
      regularizationHours: DEFAULT_PARAMETERS.fiscalRegularizationHours,
      laterInvoicingDays: DEFAULT_PARAMETERS.laterInvoicingDays,
    },
    states: {
      set: (tenantId, saleId, state) => sales.maintenance.setFiscalState(tenantId, saleId, state),
      markBilled: (tenantId, saleId) => sales.maintenance.markBilled(tenantId, saleId),
    },
  });

  const returns = createReturnsModule({
    db: deps.db,
    clock: deps.clock,
    ids: uuidGenerator,
    access,
    commercialAudit,
    defaultWindowDays: DEFAULT_PARAMETERS.returnWindowDays,
    shifts: cash.sales,
    sales: {
      addReturned: (tenantId, itemId, quantity) =>
        sales.maintenance.addReturned(tenantId, itemId, quantity),
      subtractReturned: (tenantId, itemId, quantity) =>
        sales.maintenance.subtractReturned(tenantId, itemId, quantity),
      markVoided: (tenantId, saleId) => sales.maintenance.markVoided(tenantId, saleId),
    },
    stock: {
      apply: async (actor, change) => {
        await inventory.ledger.apply(actor, change);
      },
    },
    credit: collections.credit,
    gateway: collections.gateway,
    // Anular y reembolsar en efectivo consumen un PIN de un AS (RF-081).
    authorizations: {
      consume: (input) => identity.useCases.consumeAuthorization.execute(input),
    },
  });

  // Alertas por destinatario, recordatorios y avisos en vivo (T-227, T-228; AD-06).
  const alerts = createAlertsModule({
    db: deps.db,
    clock: deps.clock,
    access,
    commercialAudit,
    tokens: accessTokens,
    sessions: identity.sessionStatus,
    allowedOrigins: config.frontendOrigins,
    logger: deps.logger,
  });

  // Ticket, informe diario, dashboards y auditoría comercial: solo lectura (plan §2.18).
  const reports = createReportsModule({ db: deps.db, clock: deps.clock, access });

  const routes = [
    ...identity.routes,
    ...platform.routes,
    ...organization.routes,
    ...catalog.routes,
    ...inventory.routes,
    ...suppliers.routes,
    ...promotions.routes,
    ...quotas.routes,
    ...cash.routes,
    ...collections.routes,
    ...sales.routes,
    ...fiscal.routes,
    ...returns.routes,
    ...alerts.routes,
    ...reports.routes,
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
    cash,
    collections,
    sales,
    fiscal,
    returns,
    alerts,
    reports,
    routes,
  };
}
