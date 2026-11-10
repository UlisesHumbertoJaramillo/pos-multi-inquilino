// Vacía pos_test antes de cada prueba punta a punta (T-244 a T-247). Lo ejecuta e2e/support/app.ts.
import { closeOwnerPool, truncateAllTables } from './database.js';

await truncateAllTables();
await closeOwnerPool();
