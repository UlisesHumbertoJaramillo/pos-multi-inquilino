// Aplicaciones de prueba.
// - createTestApp: sin base de datos, para pruebas unitarias de la capa HTTP.
// - createTestApi: la API completa contra pos_test, con reloj simulado y correo en memoria.
import type { Express } from 'express';
import { createApp, type AppOptions } from '../../src/app.js';
import type { Clock } from '../../src/compartido/aplicacion/clock.js';
import type { SecurityContext } from '../../src/compartido/aplicacion/security-context.js';
import { JoseAccessTokens } from '../../src/compartido/adaptadores/auth/jose-access-tokens.js';
import type { PgDatabase } from '../../src/compartido/adaptadores/postgres/pg-database.js';
import { systemClock } from '../../src/compartido/adaptadores/clock/system-clock.js';
import { Argon2SecretHasher } from '../../src/modulos/identidad/adaptadores/crypto.js';
import type { HttpRoute } from '../../src/compartido/adaptadores/http/routes.js';
import { createApi, type Api } from '../../src/composition.js';
import type { FiscalPendingQuery } from '../../src/modulos/plataforma/aplicacion/ports.js';
import type { DependencyQuery } from '../../src/modulos/organizacion/aplicacion/ports.js';
import type { ProductDependencyQuery } from '../../src/modulos/catalogo/aplicacion/ports.js';
import { ManualClock } from './clock.js';
import { createTestDatabase } from './database.js';
import { MemoryEmailSender } from './email.js';
import { createMemoryLogger } from './logger.js';

export const TEST_FRONTEND_ORIGIN = 'https://localhost:5173';
export const TEST_AUTH_SECRET = 'secreto-de-firma-solo-para-las-pruebas-0123456789';

// argon2 liviano: las pruebas no miden la resistencia del hash, y así no tardan.
export const FAST_HASHER = new Argon2SecretHasher({
  memoryCost: 1024,
  timeCost: 1,
  parallelism: 1,
});

export function testAccessTokens(clock: Clock = systemClock): JoseAccessTokens {
  return new JoseAccessTokens(TEST_AUTH_SECRET, clock);
}

export function createTestApp(overrides: Partial<AppOptions> = {}): Express {
  return createApp({
    devRoutes: false,
    logger: createMemoryLogger(),
    security: { allowedOrigins: [TEST_FRONTEND_ORIGIN], hsts: false },
    accessTokens: testAccessTokens(),
    // Sin base de datos: toda sesión con un token válido se considera vigente.
    sessionStatus: { isActive: () => Promise.resolve(true) },
    ...overrides,
  });
}

// Cabecera Authorization con un token válido para el contexto indicado.
export async function bearer(
  context: Partial<SecurityContext> = {},
  clock: Clock = systemClock,
): Promise<string> {
  const { token } = await testAccessTokens(clock).issue({
    userId: '99999999-9999-4999-8999-999999999999',
    tenantId: null,
    activeRole: null,
    branchIds: [],
    sessionId: '88888888-8888-4888-8888-888888888888',
    ...context,
  });
  return `Bearer ${token}`;
}

export interface TestApi extends Api {
  // Para correr casos de uso dentro de una transacción en las pruebas.
  db: PgDatabase;
  clock: ManualClock;
  email: MemoryEmailSender;
  close(): Promise<void>;
}

export interface TestApiOptions {
  publicRateLimit?: number;
  fiscalPending?: FiscalPendingQuery;
  extraRoutes?: HttpRoute[];
  dependencies?: DependencyQuery;
  productDependencies?: ProductDependencyQuery;
}

export function createTestApi(options: TestApiOptions = {}): TestApi {
  const db = createTestDatabase();
  const clock = new ManualClock();
  const email = new MemoryEmailSender();
  const api = createApi(
    {
      production: false,
      frontendOrigins: [TEST_FRONTEND_ORIGIN],
      authTokenSecret: TEST_AUTH_SECRET,
      emailAdapter: 'console',
      appPublicUrl: TEST_FRONTEND_ORIGIN,
      sessionIdleMinutes: 30,
    },
    {
      db,
      clock,
      logger: createMemoryLogger(),
      hasher: FAST_HASHER,
      email,
      publicRateLimit: { windowMs: 60_000, limit: options.publicRateLimit ?? 10_000 },
      ...(options.fiscalPending ? { fiscalPending: options.fiscalPending } : {}),
      ...(options.extraRoutes ? { extraRoutes: options.extraRoutes } : {}),
      ...(options.dependencies ? { dependencies: options.dependencies } : {}),
      ...(options.productDependencies ? { productDependencies: options.productDependencies } : {}),
    },
  );
  return { ...api, db, clock, email, close: () => db.close() };
}
