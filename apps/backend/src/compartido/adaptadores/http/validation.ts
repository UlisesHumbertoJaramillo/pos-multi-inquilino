// Validación de entradas en el servidor (Const. 17). El mensaje nombra los campos con problemas,
// sin repetir los valores recibidos.
import type { z } from 'zod';
import { ApplicationError } from '../../aplicacion/errors.js';

export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || 'cuerpo'))];
  throw new ApplicationError(
    'invalid_request',
    'DATOS_INVALIDOS',
    `Los datos enviados no son válidos: ${fields.join(', ')}.`,
  );
}
