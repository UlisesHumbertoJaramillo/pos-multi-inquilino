// Documentación interactiva de la API (Swagger UI), solo en desarrollo (T-013, AD-21).
// Muestra el contrato de packages/contracts/openapi.yaml, que es la fuente de verdad de la API.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';

const SPEC_PATH = fileURLToPath(import.meta.resolve('@pos/contracts/openapi.yaml'));

export function createDocsRouter(): Router {
  const spec = parse(readFileSync(SPEC_PATH, 'utf8')) as swaggerUi.JsonObject;
  const router = Router();
  router.use('/', swaggerUi.serve, swaggerUi.setup(spec));
  return router;
}
