// Adaptador del puerto IdGenerator con UUID aleatorios (v4).
import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../../aplicacion/id-generator.js';

export const uuidGenerator: IdGenerator = {
  next: () => randomUUID(),
};
