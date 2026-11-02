// Errores esperados de la aplicación (T-015). No conocen HTTP: el adaptador decide el estado.
// El código es estable para el frontend y el mensaje se muestra al usuario (en español).
export type ErrorKind =
  'invalid_request' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'locked';

export class ApplicationError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}

// Un recurso de otro comercio se responde igual que uno inexistente (RF-002).
export function notFoundError(): ApplicationError {
  return new ApplicationError('not_found', 'NO_ENCONTRADO', 'El recurso solicitado no existe.');
}

export function forbiddenError(): ApplicationError {
  return new ApplicationError(
    'forbidden',
    'SIN_PERMISO',
    'No tenés permiso para realizar esta acción.',
  );
}
