// Una vez por corrida: recrea el esquema de pos_test y aplica todas las migraciones.
import { migrate, resetSchema } from '../../scripts/db/migrations.js';
import { TEST_DATABASE } from './database.js';

export default async function setup(): Promise<void> {
  await resetSchema(TEST_DATABASE);
  await migrate(TEST_DATABASE, 'up');
}
