// Verifica el entorno local antes de `npm run dev` (T-007).
// PostgreSQL corre como servicio de Windows: este script no lo levanta, solo comprueba que responda.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const ROOT = resolve(import.meta.dirname, '../../..');
const ENV_PATH = resolve(ROOT, '.env');
const CERT_FILES = ['localhost.pem', 'localhost-key.pem'].map((file) =>
  resolve(ROOT, 'certs', file),
);
const APP_ROLE = 'pos_app';
const DEV_DATABASE = 'pos_dev';
const CONNECT_TIMEOUT_MS = 3000;

function fail(problem: string, fix: string): never {
  console.error(`\n✖ ${problem}\n  → ${fix}\n`);
  process.exit(1);
}

function describeDbError(error: unknown, host: string, port: number): [string, string] {
  const code = (error as { code?: unknown }).code;
  switch (code) {
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
      return [
        `PostgreSQL no responde en ${host}:${String(port)}.`,
        'Iniciá el servicio desde PowerShell como administrador: Start-Service postgresql-x64-16',
      ];
    case '28P01':
    case '28000':
      return [
        `El rol ${APP_ROLE} no existe o su contraseña no coincide con .env.`,
        'Corré `npm run db:setup`.',
      ];
    case '3D000':
      return [`No existe la base ${DEV_DATABASE}.`, 'Corré `npm run db:setup`.'];
    default:
      return [
        'No se pudo conectar a PostgreSQL.',
        error instanceof Error ? error.message : String(error),
      ];
  }
}

async function main(): Promise<void> {
  if (!existsSync(ENV_PATH)) {
    fail('Falta el archivo .env.', 'Corré `npm run db:setup`, que lo crea.');
  }
  // No pisa las variables ya definidas en el entorno.
  process.loadEnvFile(ENV_PATH);

  if (CERT_FILES.some((file) => !existsSync(file))) {
    fail('Faltan los certificados HTTPS de desarrollo.', 'Corré `npm run certs`.');
  }

  const host = process.env.DB_HOST ?? 'localhost';
  const port = Number(process.env.DB_PORT ?? '5432');
  const client = new pg.Client({
    host,
    port,
    user: APP_ROLE,
    password: process.env.DB_APP_PASSWORD ?? '',
    database: DEV_DATABASE,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (error: unknown) {
    const [problem, fix] = describeDbError(error, host, port);
    fail(problem, fix);
  } finally {
    await client.end().catch(() => undefined);
  }

  console.log(`✔ PostgreSQL responde en ${host}:${String(port)} y los certificados están listos.`);
}

await main();
