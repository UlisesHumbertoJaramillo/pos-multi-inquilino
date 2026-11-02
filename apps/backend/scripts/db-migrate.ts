// Comandos de migraciones (T-008).
//   tsx scripts/db-migrate.ts up [--db pos_test]          aplica las migraciones pendientes
//   tsx scripts/db-migrate.ts down [--db pos_test]        revierte la última migración
//   tsx scripts/db-migrate.ts reset [--db pos_test]       vacía el esquema y vuelve a aplicar todo
//   tsx scripts/db-migrate.ts new <nombre>                crea un archivo de migración vacío
// Sin --db se usa pos_dev.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ALLOWED_DATABASES,
  isAllowedDatabase,
  migrate,
  MIGRATIONS_DIR,
  resetSchema,
  type AllowedDatabase,
} from './db/migrations.js';

const MIGRATION_TEMPLATE = '-- Up Migration\n\n-- Down Migration\n';

function describeError(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  if (code === 'ECONNREFUSED') {
    return 'PostgreSQL no responde. Verificá que el servicio postgresql-x64-16 esté iniciado.';
  }
  if (code === '28P01') return 'La contraseña de pos_owner no coincide. Corré `npm run db:setup`.';
  return error instanceof Error ? error.message : String(error);
}

function printApplied(applied: { name: string }[], verb: string): void {
  if (applied.length === 0) {
    console.log('No hay migraciones para aplicar.');
    return;
  }
  for (const { name } of applied) console.log(`  ${verb} ${name}`);
}

function createMigration(name: string | undefined): void {
  if (!name || !/^[a-z0-9_]+$/.test(name)) {
    throw new Error('Indicá un nombre en snake_case, por ejemplo: crear_comercio');
  }
  const file = resolve(MIGRATIONS_DIR, `${String(Date.now())}_${name}.sql`);
  writeFileSync(file, MIGRATION_TEMPLATE, { flag: 'wx' });
  console.log(`Migración creada: ${file}`);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { db: { type: 'string', default: 'pos_dev' } },
  });
  const [command, name] = positionals;
  if (command === 'new') {
    createMigration(name);
    return;
  }

  if (!isAllowedDatabase(values.db)) {
    throw new Error(`Base no permitida: ${values.db}. Opciones: ${ALLOWED_DATABASES.join(', ')}.`);
  }
  const database: AllowedDatabase = values.db;

  switch (command) {
    case 'up':
      printApplied(await migrate(database, 'up'), 'aplicada');
      break;
    case 'down':
      printApplied(await migrate(database, 'down', 1), 'revertida');
      break;
    case 'reset':
      await resetSchema(database);
      console.log(`Esquema de ${database} vaciado.`);
      printApplied(await migrate(database, 'up'), 'aplicada');
      break;
    default:
      throw new Error('Comando desconocido. Usá: up, down, reset o new <nombre>.');
  }
  console.log(`Listo (${database}).`);
}

main().catch((error: unknown) => {
  console.error(`Error: ${describeError(error)}`);
  process.exitCode = 1;
});
