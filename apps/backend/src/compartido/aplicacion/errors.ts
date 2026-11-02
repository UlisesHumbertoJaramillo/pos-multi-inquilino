// Errores esperados de la aplicación (T-015). No conocen HTTP: el adaptador decide el estado.
// El código es estable para el frontend y el mensaje se muestra al usuario (en español).
export type ErrorKind =
  'invalid_request' | 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict';

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
