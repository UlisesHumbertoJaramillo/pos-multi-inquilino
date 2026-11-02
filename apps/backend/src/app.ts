import express, { Router, type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AccessTokens } from './compartido/aplicacion/access-tokens.js';
import type { Logger } from './compartido/aplicacion/logger.js';
import { authenticate } from './compartido/adaptadores/http/authentication.js';
import { createDocsRouter } from './compartido/adaptadores/http/docs.js';
import { createErrorHandler, notFoundHandler } from './compartido/adaptadores/http/errors.js';
import { assertValidRoutes, type HttpRoute } from './compartido/adaptadores/http/routes.js';
import {
  corsPolicy,
  jsonBody,
  securityHeaders,
  type SecurityOptions,
} from './compartido/adaptadores/http/security.js';

export interface RateLimitOptions {
  windowMs: number;
  limit: number;
}

export interface AppOptions {
  // Rutas solo para desarrollo, como /docs. Nunca se registran en producción (Const. 16).
  devRoutes: boolean;
  logger: Logger;
  security: SecurityOptions;
  accessTokens: AccessTokens;
  // Rutas de los módulos. /salud se agrega siempre.
  routes?: readonly HttpRoute[];
  // Límite de frecuencia de las rutas públicas, por IP (Const. 17).
  publicRateLimit?: RateLimitOptions;
}

const DEFAULT_PUBLIC_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, limit: 30 };

// Salud del sistema: pública (Const. 16) y sin versiones ni datos internos.
const HEALTH_ROUTE: HttpRoute = {
  method: 'get',
  path: '/salud',
  public: 'salud',
  rateLimited: false,
  handler: (_req, res) => {
    res.json({ estado: 'ok' });
  },
};

export function allRoutes(options: Pick<AppOptions, 'routes'>): HttpRoute[] {
  return [HEALTH_ROUTE, ...(options.routes ?? [])];
}

export function createApp(options: AppOptions): Express {
  const routes = allRoutes(options);
  assertValidRoutes(routes);

  const app = express();
  // No anunciar el framework en las respuestas (Const. 17).
  app.disable('x-powered-by');

  // Antes de cualquier ruta: cabeceras de seguridad, CORS y límite del cuerpo (T-016).
  app.use(securityHeaders(options.security));
  app.use(corsPolicy(options.security));
  app.use(jsonBody());

  // Rutas públicas de la lista blanca (AD-22), con límite de frecuencia.
  const limits = options.publicRateLimit ?? DEFAULT_PUBLIC_RATE_LIMIT;
  const publicLimiter = rateLimit({
    windowMs: limits.windowMs,
    limit: limits.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        codigo: 'DEMASIADAS_SOLICITUDES',
        mensaje: 'Hiciste demasiadas solicitudes. Esperá un momento y volvé a intentar.',
      });
    },
  });
  const publicRouter = Router();
  for (const route of routes.filter((r) => r.public !== undefined)) {
    const handlers = route.rateLimited === false ? [route.handler] : [publicLimiter, route.handler];
    publicRouter[route.method](route.path, ...handlers);
  }
  app.use(publicRouter);

  if (options.devRoutes) {
    app.use('/docs', createDocsRouter());
  }

  // Todo lo que sigue exige un token de acceso válido (Const. 16).
  app.use(authenticate(options.accessTokens));
  const protectedRouter = Router();
  for (const route of routes.filter((r) => r.public === undefined)) {
    protectedRouter[route.method](route.path, route.handler);
  }
  app.use(protectedRouter);

  // Siempre al final: rutas inexistentes y errores, con respuesta uniforme (T-015).
  app.use(notFoundHandler);
  app.use(createErrorHandler(options.logger));

  return app;
}
