// Documentación interactiva de la API (Swagger UI), solo en desarrollo (T-013, AD-21).
// Muestra el contrato de packages/contracts/openapi.yaml, que es la fuente de verdad de la API.
import { Router } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { loadOpenApiSpec } from './openapi-spec.js';

export function createDocsRouter(): Router {
  const router = Router();
  // Swagger UI carga sus propios scripts y estilos: reemplaza la política estricta de la API.
  router.use(helmet.contentSecurityPolicy({ useDefaults: true }));
  router.use('/', swaggerUi.serve, swaggerUi.setup(loadOpenApiSpec()));
  return router;
}
