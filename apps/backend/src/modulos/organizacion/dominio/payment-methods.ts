// Métodos de pago con recargo (positivo) o descuento (negativo) (RF-068, RF-069, RF-135).
import { DomainError } from '../../../compartido/dominio/errors.js';

export const PAYMENT_TYPES = ['efectivo', 'electronico', 'cuenta_corriente'] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export interface PaymentMethod {
  id: string;
  tenantId: string;
  name: string;
  type: PaymentType;
  // Porcentaje con hasta 4 decimales, como texto para no perder precisión (AD-08).
  surchargePct: string;
  isActive: boolean;
}

// Margen de la plataforma para el recargo o descuento de un método de pago.
export const SURCHARGE_MARGIN = { min: -50, max: 100 } as const;

export function normalizeSurcharge(value: string): string {
  if (!/^-?\d{1,3}(\.\d{1,4})?$/.test(value.trim())) {
    throw new DomainError(
      'RECARGO_INVALIDO',
      'El recargo tiene que ser un porcentaje con hasta 4 decimales, por ejemplo 10 o -5.',
    );
  }
  const number = Number(value);
  if (number < SURCHARGE_MARGIN.min || number > SURCHARGE_MARGIN.max) {
    throw new DomainError(
      'RECARGO_INVALIDO',
      `El recargo tiene que estar entre ${String(SURCHARGE_MARGIN.min)}% y ${String(SURCHARGE_MARGIN.max)}%.`,
    );
  }
  return number.toFixed(4);
}
