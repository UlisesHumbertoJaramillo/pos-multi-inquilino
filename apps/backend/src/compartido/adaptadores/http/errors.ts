// Respuestas de error uniformes {codigo, mensaje}, sin detalles internos (T-015, Const. 17).
// Los errores inesperados se registran con su detalle y al cliente solo le llega un mensaje genérico.
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ApplicationError, type ErrorKind } from '../../aplicacion/errors.js';
import type { Logger } from '../../aplicacion/logger.js';
import { DomainError } from '../../dominio/errors.js';

export interface ErrorBody {
  codigo: string;
  mensaje: string;
}

export const INTERNAL_ERROR: ErrorBody = {
  codigo: 'ERROR_INTERNO',
  mensaje: 'Ocurrió un error inesperado.',
};

export const NOT_FOUND_ERROR: ErrorBody = {
  codigo: 'NO_ENCONTRADO',
  mensaje: 'El recurso solicitado no existe.',
};

const INVALID_REQUEST_ERROR: ErrorBody = {
  codigo: 'SOLICITUD_INVALIDA',
  mensaje: 'La solicitud no es válida.',
};

const PAYLOAD_TOO_LARGE_ERROR: ErrorBody = {
  codigo: 'SOLICITUD_DEMASIADO_GRANDE',
  mensaje: 'La solicitud supera el tamaño permitido.',
};

const STATUS_BY_KIND: Record<ErrorKind, number> = {
  invalid_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};

// Errores 4xx de Express y sus middlewares (por ejemplo, un JSON mal formado).
function clientErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { status, expose } = error as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true
    ? status
    : undefined;
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(NOT_FOUND_ERROR);
};

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof ApplicationError) {
      res.status(STATUS_BY_KIND[error.kind]).json({ codigo: error.code, mensaje: error.message });
      return;
    }

    // Una regla de negocio impidió la operación.
    if (error instanceof DomainError) {
      res.status(409).json({ codigo: error.code, mensaje: error.message });
      return;
    }

    const clientStatus = clientErrorStatus(error);
    if (clientStatus !== undefined) {
      res
        .status(clientStatus)
        .json(clientStatus === 413 ? PAYLOAD_TOO_LARGE_ERROR : INVALID_REQUEST_ERROR);
      return;
    }

    // Solo la ruta, sin la query: podría traer datos sensibles.
    logger.error('Error no controlado al atender una solicitud', {
      method: req.method,
      path: req.path,
      err: error,
    });
    res.status(500).json(INTERNAL_ERROR);
  };
}
