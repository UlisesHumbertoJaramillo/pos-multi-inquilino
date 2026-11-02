// Autenticación de las solicitudes (T-031, T-035, Const. 16).
// Se monta después de las rutas públicas: toda solicitud que llega hasta aquí exige un token de
// acceso válido, incluso las rutas inexistentes, para no revelar qué rutas existen.
import type { Request, RequestHandler, Response } from 'express';
import type { AccessTokens } from '../../aplicacion/access-tokens.js';
import { ApplicationError } from '../../aplicacion/errors.js';
import type { SecurityContext } from '../../aplicacion/security-context.js';

const BEARER = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/;

export function unauthenticatedError(): ApplicationError {
  return new ApplicationError(
    'unauthenticated',
    'NO_AUTENTICADO',
    'La sesión no es válida o venció. Volvé a iniciar sesión.',
  );
}

export function authenticate(tokens: AccessTokens): RequestHandler {
  return async (req, res, next) => {
    const match = BEARER.exec(req.headers.authorization ?? '');
    const context = match?.[1] ? await tokens.verify(match[1]) : null;
    if (!context) {
      next(unauthenticatedError());
      return;
    }
    res.locals.security = context;
    next();
  };
}

// Contexto de seguridad de la solicitud: siempre del token, nunca de parámetros ni del cuerpo.
export function securityContextOf(res: Response): SecurityContext {
  const context = res.locals.security as SecurityContext | undefined;
  if (!context) throw unauthenticatedError();
  return context;
}

export function clientIp(req: Request): string | null {
  return req.ip ?? null;
}
