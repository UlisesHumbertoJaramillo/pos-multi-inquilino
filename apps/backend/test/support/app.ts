// Aplicación de prueba con opciones por defecto, que cada prueba puede reemplazar.
import type { Express } from 'express';
import { createApp, type AppOptions } from '../../src/app.js';
import { createMemoryLogger } from './logger.js';

export const TEST_FRONTEND_ORIGIN = 'https://localhost:5173';

export function createTestApp(overrides: Partial<AppOptions> = {}): Express {
  return createApp({
    devRoutes: false,
    logger: createMemoryLogger(),
    security: { allowedOrigins: [TEST_FRONTEND_ORIGIN], hsts: false },
    ...overrides,
  });
}
