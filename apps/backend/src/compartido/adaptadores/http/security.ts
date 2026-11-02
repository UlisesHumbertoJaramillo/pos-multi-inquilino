// Protecciones HTTP comunes a toda la API (T-016, Const. 17).
import cors from 'cors';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';
import { ApplicationError } from '../../aplicacion/errors.js';

// Tamaño máximo del cuerpo JSON de una solicitud.
export const MAX_JSON_BODY = '100kb';

export interface SecurityOptions {
  // Orígenes del frontend que pueden llamar a la API desde el navegador.
  allowedOrigins: readonly string[];
  // HSTS solo en producción: en desarrollo, el navegador lo recordaría para todo localhost.
  hsts: boolean;
}

export function securityHeaders(options: Pick<SecurityOptions, 'hsts'>): RequestHandler {
  return helmet({
    // La API solo devuelve JSON: no carga ni ejecuta nada, y no se muestra dentro de otra página.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    strictTransportSecurity: options.hsts,
  });
}

// Un origen no permitido se rechaza en el servidor, no solo en el navegador.
export function corsPolicy(options: Pick<SecurityOptions, 'allowedOrigins'>): RequestHandler {
  return cors({
    origin: (origin, callback) => {
      // Sin cabecera Origin no es una llamada entre sitios desde un navegador (curl, mismo origen).
      if (origin === undefined || options.allowedOrigins.includes(origin)) {
        callback(null, origin ?? false);
        return;
      }
      callback(
        new ApplicationError(
          'forbidden',
          'ORIGEN_NO_PERMITIDO',
          'El origen de la solicitud no está permitido.',
        ),
      );
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
}

export function jsonBody(): RequestHandler {
  return express.json({ limit: MAX_JSON_BODY });
}
