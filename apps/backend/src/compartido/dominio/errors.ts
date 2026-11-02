// Violación de una regla de negocio del dominio. El adaptador HTTP la responde como conflicto (409).
// El código es estable para el frontend y el mensaje se muestra al usuario (en español).
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
