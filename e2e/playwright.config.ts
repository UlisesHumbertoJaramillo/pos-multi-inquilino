// Pruebas punta a punta en navegador (T-244 a T-247). Levanta la API, el worker y el frontend reales
// sobre pos_test; cada prueba arranca con los datos de demostración recién cargados.
//   npm run test:e2e
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { API_URL, DATABASE, WEB_URL } from './support/env.js';

const ROOT = resolve(import.meta.dirname, '..');
const backendEnv = {
  DB_NAME: DATABASE,
  FRONTEND_ORIGIN: WEB_URL,
  APP_PUBLIC_URL: WEB_URL,
  // La cola fiscal se procesa enseguida: en producción la pasada es cada 30 segundos.
  FISCAL_SWEEP_MS: '1000',
  WORKER_POLL_MS: '250',
  // Las pruebas inician y renuevan muchas sesiones por minuto desde la misma dirección: el límite de
  // las rutas públicas (30 por minuto) cortaría la suite en un servidor rápido, como el del CI.
  PUBLIC_RATE_LIMIT: '600',
};

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // Una sola base compartida: las pruebas no pueden correr a la vez.
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: '../test-results',
  use: {
    baseURL: WEB_URL,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'npx tsx apps/backend/src/server.ts',
      cwd: ROOT,
      url: `${API_URL}/salud`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...backendEnv, PORT: '3100' },
    },
    {
      command: 'npx tsx apps/backend/src/worker.ts',
      cwd: ROOT,
      reuseExistingServer: false,
      env: backendEnv,
    },
    {
      command: 'npm run dev -w @pos/frontend -- --port 5174',
      cwd: ROOT,
      url: WEB_URL,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_URL: API_URL },
    },
  ],
});
