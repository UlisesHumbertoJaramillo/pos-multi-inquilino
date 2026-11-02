// Migraciones de la base con node-pg-migrate (T-008).
// Siempre se conectan como pos_owner, el dueño de las tablas. La aplicación usa pos_app.
// El arnés de pruebas (T-010) reutiliza estas funciones para recrear pos_test.
import { resolve } from 'node:path';
import { runner } from 'node-pg-migrate';
import pg from 'pg';

// node-pg-migrate no exporta este tipo: se toma del resultado de runner.
export type RunMigration = Awaited<ReturnType<typeof runner>>[number];

export const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../migrations');
export const MIGRATIONS_TABLE = 'pgmigrations';
export const ALLOWED_DATABASES = ['pos_dev', 'pos_test'] as const;
export type AllowedDatabase = (typeof ALLOWED_DATABASES)[number];

const OWNER_ROLE = 'pos_owner';
const APP_ROLE = 'pos_app';
const ENV_PATH = resolve(import.meta.dirname, '../../../../.env');

export function isAllowedDatabase(name: string): name is AllowedDatabase {
  return (ALLOWED_DATABASES as readonly string[]).includes(name);
}

export function ownerConnection(database: AllowedDatabase): pg.ClientConfig {
  try {
    // No pisa las variables ya definidas en el entorno.
    process.loadEnvFile(ENV_PATH);
  } catch {
    // Sin .env se usan las variables del entorno.
  }
  const password = process.env.DB_OWNER_PASSWORD;
  if (!password) {
    throw new Error('Falta DB_OWNER_PASSWORD. Corré `npm run db:setup`.');
  }
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? '5432'),
    user: OWNER_ROLE,
    password,
    database,
  };
}

export async function migrate(
  database: AllowedDatabase,
  direction: 'up' | 'down' = 'up',
  count?: number,
): Promise<RunMigration[]> {
  return runner({
    databaseUrl: ownerConnection(database),
    dir: MIGRATIONS_DIR,
    migrationsTable: MIGRATIONS_TABLE,
    direction,
    ...(count === undefined ? {} : { count }),
    checkOrder: true,
    singleTransaction: true,
    migrationLoaderStrategies: [{ extensions: ['.sql'], loader: 'sql' }],
    log: () => undefined,
  });
}

// Borra todo el esquema public y lo vuelve a crear vacío, con los mismos permisos que deja db:setup.
export async function resetSchema(database: AllowedDatabase): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:reset no se ejecuta en producción.');
  }
  const client = new pg.Client(ownerConnection(database));
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query(`CREATE SCHEMA public AUTHORIZATION ${OWNER_ROLE}`);
    await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await client.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
