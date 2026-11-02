import express, { type Express } from 'express';
import type { Logger } from './compartido/aplicacion/logger.js';
import { createDocsRouter } from './compartido/adaptadores/http/docs.js';
import { createErrorHandler, notFoundHandler } from './compartido/adaptadores/http/errors.js';
import {
  corsPolicy,
  jsonBody,
  securityHeaders,
  type SecurityOptions,
} from './compartido/adaptadores/http/security.js';

export interface AppOptions {
  // Rutas solo para desarrollo, como /docs. Nunca se registran en producción (Const. 16).
  devRoutes: boolean;
  logger: Logger;
  security: SecurityOptions;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  // No anunciar el framework en las respuestas (Const. 17).
  app.disable('x-powered-by');

  // Antes de cualquier ruta: cabeceras de seguridad, CORS y límite del cuerpo (T-016).
  app.use(securityHeaders(options.security));
  app.use(corsPolicy(options.security));
  app.use(jsonBody());

  // Salud del sistema: pública (Const. 16) y sin versiones ni datos internos.
  app.get('/salud', (_req, res) => {
    res.json({ estado: 'ok' });
  });

  if (options.devRoutes) {
    app.use('/docs', createDocsRouter());
  }

  // Siempre al final: rutas inexistentes y errores, con respuesta uniforme (T-015).
  app.use(notFoundHandler);
  app.use(createErrorHandler(options.logger));

  return app;
}
