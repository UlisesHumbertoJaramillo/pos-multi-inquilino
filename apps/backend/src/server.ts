// Punto de entrada del backend: sirve la API solo por HTTPS (Const. 17).
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { createPinoLogger } from './compartido/adaptadores/logging/pino-logger.js';

const ENV_PATH = resolve(import.meta.dirname, '../../../.env');
if (existsSync(ENV_PATH)) {
  // No pisa las variables ya definidas en el entorno.
  process.loadEnvFile(ENV_PATH);
}

const PORT = Number(process.env.PORT ?? '3000');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
// Orígenes del frontend permitidos por CORS, separados por coma.
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN ?? 'https://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const CERTS_DIR = resolve(import.meta.dirname, '../../../certs');
const CERT_FILE = resolve(CERTS_DIR, 'localhost.pem');
const KEY_FILE = resolve(CERTS_DIR, 'localhost-key.pem');

const logger = createPinoLogger();

if (!existsSync(CERT_FILE) || !existsSync(KEY_FILE)) {
  logger.error('Faltan los certificados HTTPS. Generalos con `npm run certs`.');
  process.exit(1);
}

const server = createServer(
  { cert: readFileSync(CERT_FILE), key: readFileSync(KEY_FILE) },
  createApp({
    devRoutes: !IS_PRODUCTION,
    logger,
    security: { allowedOrigins: FRONTEND_ORIGINS, hsts: IS_PRODUCTION },
  }),
);

server.listen(PORT, () => {
  logger.info(`API escuchando en https://localhost:${String(PORT)}`);
});
