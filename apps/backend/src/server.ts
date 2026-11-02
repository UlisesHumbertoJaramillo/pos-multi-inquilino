// Punto de entrada del backend: sirve la API solo por HTTPS (Const. 17).
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { resolve } from 'node:path';
import { systemClock } from './compartido/adaptadores/clock/system-clock.js';
import { createPinoLogger } from './compartido/adaptadores/logging/pino-logger.js';
import { PgDatabase } from './compartido/adaptadores/postgres/pg-database.js';
import { appDatabaseConfigFromEnv, createPgPool } from './compartido/adaptadores/postgres/pool.js';
import { apiConfigFromEnv, createApi } from './composition.js';

const ENV_PATH = resolve(import.meta.dirname, '../../../.env');
if (existsSync(ENV_PATH)) {
  // No pisa las variables ya definidas en el entorno.
  process.loadEnvFile(ENV_PATH);
}

const PORT = Number(process.env.PORT ?? '3000');
const CERTS_DIR = resolve(import.meta.dirname, '../../../certs');
const CERT_FILE = resolve(CERTS_DIR, 'localhost.pem');
const KEY_FILE = resolve(CERTS_DIR, 'localhost-key.pem');

const logger = createPinoLogger();

if (!existsSync(CERT_FILE) || !existsSync(KEY_FILE)) {
  logger.error('Faltan los certificados HTTPS. Generalos con `npm run certs`.');
  process.exit(1);
}

let app;
try {
  const db = new PgDatabase(createPgPool(appDatabaseConfigFromEnv(process.env), logger));
  ({ app } = createApi(apiConfigFromEnv(process.env), { db, clock: systemClock, logger }));
} catch (error: unknown) {
  // Configuración insegura o incompleta: el backend no arranca (Const. 17).
  logger.error('El backend no puede arrancar con esta configuración', { err: error });
  process.exit(1);
}

const server = createServer({ cert: readFileSync(CERT_FILE), key: readFileSync(KEY_FILE) }, app);

server.listen(PORT, () => {
  logger.info(`API escuchando en https://localhost:${String(PORT)}`);
});
