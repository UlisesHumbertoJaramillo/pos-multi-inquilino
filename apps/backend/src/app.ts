import express, { type Express } from 'express';
import { createDocsRouter } from './compartido/adaptadores/http/docs.js';

export interface AppOptions {
  // Rutas solo para desarrollo, como /docs. Nunca se registran en producción (Const. 16).
  devRoutes: boolean;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  // No anunciar el framework en las respuestas (Const. 17).
  app.disable('x-powered-by');

  // Salud del sistema: pública (Const. 16) y sin versiones ni datos internos.
  app.get('/salud', (_req, res) => {
    res.json({ estado: 'ok' });
  });

  if (options.devRoutes) {
    app.use('/docs', createDocsRouter());
  }

  return app;
}
