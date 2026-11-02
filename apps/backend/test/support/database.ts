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
export async function ownerQuery(sql: string, values?: unknown[]): Promise<void> {
  await getOwnerPool().query(sql, values);
}

// Lectura como dueño, sin seguridad a nivel de fila: para verificar lo que quedó en la base.
export async function ownerSelect<R extends pg.QueryResultRow>(
  sql: string,
  values?: unknown[],
): Promise<R[]> {
  return (await getOwnerPool().query<R>(sql, values)).rows;
}

interface CleanupPlan {
  // Las que referencian a otras van primero, para que el borrado no viole claves foráneas.
  tables: string[];
  identities: string[];
}

let cleanupPlan: Promise<CleanupPlan> | undefined;

async function buildCleanupPlan(pool: pg.Pool): Promise<CleanupPlan> {
  const tables = (
    await pool.query<{ name: string }>(
      `SELECT format('%I', tablename) AS name FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> $1`,
      [MIGRATIONS_TABLE],
    )
  ).rows.map((row) => row.name);
  const references = (
    await pool.query<{ child: string; parent: string }>(
      `SELECT format('%I', conrelid::regclass::text) AS child,
              format('%I', confrelid::regclass::text) AS parent
         FROM pg_constraint
        WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND conrelid <> confrelid`,
    )
  ).rows;
  const identities = (
    await pool.query<{ name: string }>(
      `SELECT pg_get_serial_sequence(format('%I.%I', table_schema, table_name), column_name) AS name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND is_identity = 'YES'`,
    )
  ).rows.map((row) => row.name);

  const ordered: string[] = [];
  const pending = new Set(tables);
  while (pending.size > 0) {
    const ready = [...pending].filter(
      (table) => !references.some((r) => r.parent === table && pending.has(r.child)),
    );
    if (ready.length === 0) throw new Error('Hay claves foráneas circulares entre tablas.');
    for (const table of ready) {
      ordered.push(table);
      pending.delete(table);
    }
  }
  return { tables: ordered, identities };
}

// Borra solo las tablas con filas, en orden de dependencias: con pocas filas, DELETE es mucho más
// rápido que TRUNCATE, que tiene un costo fijo por tabla.
export async function truncateAllTables(): Promise<void> {
  const pool = getOwnerPool();
  cleanupPlan ??= buildCleanupPlan(pool);
  const { tables, identities } = await cleanupPlan;
  const filled = new Set(
    (
      await pool.query<{ name: string }>(
        tables
          .map((t) => `SELECT '${t}' AS name WHERE EXISTS (SELECT 1 FROM ${t})`)
          .join(' UNION ALL '),
      )
    ).rows.map((row) => row.name),
  );
  const statements = [
    ...tables.filter((t) => filled.has(t)).map((t) => `DELETE FROM ${t}`),
    ...identities.map((sequence) => `ALTER SEQUENCE ${sequence} RESTART`),
  ];
  await pool.query(statements.join('; '));
}

export async function closeOwnerPool(): Promise<void> {
  await ownerPool?.end();
  ownerPool = undefined;
}
