// Conexiones del arnés de pruebas de integración (T-010).
// Todas apuntan a pos_test. La conexión de pos_owner existe solo aquí, para vaciar tablas entre pruebas.
import pg from 'pg';
import { MIGRATIONS_TABLE, ownerConnection } from '../../scripts/db/migrations.js';
import { PgDatabase } from '../../src/compartido/adaptadores/postgres/pg-database.js';

export const TEST_DATABASE = 'pos_test';
const APP_ROLE = 'pos_app';

let ownerPool: pg.Pool | undefined;

function getOwnerPool(): pg.Pool {
  ownerPool ??= new pg.Pool({ ...ownerConnection(TEST_DATABASE), max: 1 });
  return ownerPool;
}

// Conexión con el rol de la aplicación: la que usan las pruebas para verificar permisos reales.
export function appConnection(): pg.ClientConfig {
  const owner = ownerConnection(TEST_DATABASE);
  const password = process.env.DB_APP_PASSWORD;
  if (!password) {
    throw new Error('Falta DB_APP_PASSWORD. Corré `npm run db:setup`.');
  }
  return { ...owner, user: APP_ROLE, password };
}

// PgDatabase con el rol de la aplicación sobre pos_test. La prueba la cierra al terminar.
export function createTestDatabase(): PgDatabase {
  return new PgDatabase(new pg.Pool({ ...appConnection(), max: 5 }));
}

export async function withAppClient<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(appConnection());
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

// Solo para preparar datos o estructuras de prueba que la aplicación no puede crear.
export async function ownerQuery(sql: string): Promise<void> {
  await getOwnerPool().query(sql);
}

export async function truncateAllTables(): Promise<void> {
  const pool = getOwnerPool();
  const result = await pool.query<{ tables: string | null }>(
    `SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') AS tables
       FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> $1`,
    [MIGRATIONS_TABLE],
  );
  const tables = result.rows[0]?.tables;
  if (tables) {
    await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  }
}

export async function closeOwnerPool(): Promise<void> {
  await ownerPool?.end();
  ownerPool = undefined;
}
