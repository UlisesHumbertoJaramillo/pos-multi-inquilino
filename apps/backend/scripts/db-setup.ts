// Prepara el PostgreSQL local una sola vez por equipo (T-003).
// Crea los roles pos_owner y pos_app y las bases pos_dev y pos_test.
// Se puede volver a ejecutar: lo que ya existe se actualiza, no se duplica.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import pg from 'pg';

const ENV_PATH = resolve(import.meta.dirname, '../../../.env');
const ENV_EXAMPLE_PATH = resolve(import.meta.dirname, '../../../.env.example');

const OWNER_ROLE = 'pos_owner';
const APP_ROLE = 'pos_app';
const DATABASES = ['pos_dev', 'pos_test'] as const;
const SUPERUSER = 'postgres';

interface DbConfig {
  host: string;
  port: number;
  appPassword: string;
  ownerPassword: string;
}

function setEnvValue(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
}

// Crea el .env desde .env.example si falta, y genera las contraseñas vacías.
function loadOrCreateEnv(): DbConfig {
  let content = readFileSync(existsSync(ENV_PATH) ? ENV_PATH : ENV_EXAMPLE_PATH, 'utf8');
  const values = new Map<string, string>();
  for (const match of content.matchAll(/^([A-Z_]+)=(.*)$/gm)) {
    values.set(match[1] ?? '', (match[2] ?? '').trim());
  }

  for (const key of ['DB_APP_PASSWORD', 'DB_OWNER_PASSWORD']) {
    if (!values.get(key)) {
      const generated = randomBytes(24).toString('base64url');
      values.set(key, generated);
      content = setEnvValue(content, key, generated);
      console.log(`Se generó ${key} en .env.`);
    }
  }
  writeFileSync(ENV_PATH, content);

  return {
    host: values.get('DB_HOST') ?? 'localhost',
    port: Number(values.get('DB_PORT') ?? '5432'),
    appPassword: values.get('DB_APP_PASSWORD') ?? '',
    ownerPassword: values.get('DB_OWNER_PASSWORD') ?? '',
  };
}

// Pide un texto sin mostrarlo en pantalla.
function askHidden(question: string): Promise<string> {
  return new Promise((resolvePrompt, rejectPrompt) => {
    if (!stdin.isTTY) {
      rejectPrompt(
        new Error('Ejecutá el script desde una terminal interactiva, o definí PGPASSWORD.'),
      );
      return;
    }
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    let value = '';
    const finish = (): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish();
          resolvePrompt(value);
          return;
        }
        if (char === '\u0003') {
          finish();
          rejectPrompt(new Error('Cancelado.'));
          return;
        }
        value = char === '\u0008' || char === '\u007f' ? value.slice(0, -1) : value + char;
      }
    };
    stdin.on('data', onData);
  });
}

async function withClient<T>(
  config: pg.ClientConfig,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client(config);
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function upsertRole(client: pg.Client, role: string, password: string): Promise<void> {
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  const isNew = exists.rowCount === 0;
  // CREATE/ALTER ROLE no admite parámetros: el nombre es una constante y la contraseña se escapa.
  await client.query(
    `${isNew ? 'CREATE' : 'ALTER'} ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE ` +
      `NOREPLICATION NOBYPASSRLS PASSWORD ${client.escapeLiteral(password)}`,
  );
  console.log(`Rol ${role}: ${isNew ? 'creado' : 'actualizado'}.`);
}

async function ensureDatabase(client: pg.Client, database: string): Promise<void> {
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (exists.rowCount === 0) {
    await client.query(
      `CREATE DATABASE ${database} OWNER ${OWNER_ROLE} ENCODING 'UTF8' TEMPLATE template0`,
    );
    console.log(`Base ${database}: creada.`);
  } else {
    await client.query(`ALTER DATABASE ${database} OWNER TO ${OWNER_ROLE}`);
    console.log(`Base ${database}: ya existía.`);
  }
  await client.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${APP_ROLE}`);
}

async function grantSchemaUsage(config: pg.ClientConfig, database: string): Promise<void> {
  await withClient({ ...config, database }, async (client) => {
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await client.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  });
}

// Comprueba lo que exige T-003: pos_app conecta y no es dueño ni superusuario.
async function verifyAppRole(db: DbConfig): Promise<void> {
  const row = await withClient(
    { host: db.host, port: db.port, user: APP_ROLE, password: db.appPassword, database: 'pos_dev' },
    async (client) => {
      const result = await client.query<{
        owner: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        `SELECT pg_get_userbyid(d.datdba) AS owner, r.rolsuper, r.rolbypassrls
           FROM pg_database d, pg_roles r
          WHERE d.datname = current_database() AND r.rolname = current_user`,
      );
      return result.rows[0];
    },
  );
  if (!row || row.owner === APP_ROLE || row.rolsuper || row.rolbypassrls) {
    throw new Error(`${APP_ROLE} tiene privilegios que no debería tener.`);
  }
  console.log(
    `Verificado: ${APP_ROLE} conecta a pos_dev, el dueño es ${row.owner} y no saltea RLS.`,
  );
}

function describeError(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  if (code === '28P01') return `La contraseña del usuario ${SUPERUSER} es incorrecta.`;
  if (code === 'ECONNREFUSED') {
    return 'PostgreSQL no responde. Verificá que el servicio postgresql-x64-16 esté iniciado.';
  }
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const db = loadOrCreateEnv();
  const superPassword =
    process.env.PGPASSWORD ?? (await askHidden(`Contraseña del usuario ${SUPERUSER}: `));
  const superConfig: pg.ClientConfig = {
    host: db.host,
    port: db.port,
    user: SUPERUSER,
    password: superPassword,
    database: 'postgres',
  };

  await withClient(superConfig, async (client) => {
    await upsertRole(client, OWNER_ROLE, db.ownerPassword);
    await upsertRole(client, APP_ROLE, db.appPassword);
    for (const database of DATABASES) {
      await ensureDatabase(client, database);
    }
  });
  for (const database of DATABASES) {
    await grantSchemaUsage(superConfig, database);
  }
  await verifyAppRole(db);
  console.log('Listo. Las contraseñas de los roles están en .env.');
}

main().catch((error: unknown) => {
  console.error(`Error: ${describeError(error)}`);
  process.exitCode = 1;
});
