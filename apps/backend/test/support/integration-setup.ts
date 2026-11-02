// Antes de cada prueba de integración se vacían las tablas de pos_test.
import { afterAll, beforeEach } from 'vitest';
import { closeOwnerPool, truncateAllTables } from './database.js';

beforeEach(truncateAllTables);
afterAll(closeOwnerPool);
