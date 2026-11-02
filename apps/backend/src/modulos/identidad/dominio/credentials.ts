// Reglas de formato de las credenciales.
import { DomainError } from '../../../compartido/dominio/errors.js';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
const PIN_FORMAT = /^\d{4,6}$/;

export function assertValidPassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new DomainError(
      'CONTRASENA_INVALIDA',
      `La contraseña debe tener entre ${String(PASSWORD_MIN_LENGTH)} y ${String(PASSWORD_MAX_LENGTH)} caracteres.`,
    );
  }
}

export function assertValidPin(pin: string): void {
  if (!PIN_FORMAT.test(pin)) {
    throw new DomainError('PIN_INVALIDO', 'El PIN debe tener entre 4 y 6 dígitos.');
  }
}
