// Decimales exactos para dinero, tasas y cantidades (AD-08). Un valor es un entero BigInt con una
// escala fija de decimales: 169.40 con escala 2 es 16940n. Nunca se usa coma flotante.
// T-112 suma las reglas de redondeo y prorrateo de D-17 sobre esta base.
import { DomainError } from './errors.js';

export const MONEY_SCALE = 2;
export const RATE_SCALE = 4;
export const QUANTITY_SCALE = 3;

const DECIMAL_PATTERN = /^(-)?(\d{1,15})(?:\.(\d+))?$/;

// Convierte "169.4" a 16940n (escala 2). Rechaza más decimales de los que admite la escala.
export function parseDecimal(text: string, scale: number, what = 'El valor'): bigint {
  const match = DECIMAL_PATTERN.exec(text.trim());
  const [, sign, integer, fraction = ''] = match ?? [];
  if (integer === undefined || fraction.length > scale) {
    throw new DomainError(
      'NUMERO_INVALIDO',
      `${what} tiene que ser un número con hasta ${String(scale)} decimales.`,
    );
  }
  const value = BigInt(integer + fraction.padEnd(scale, '0'));
  return sign === '-' ? -value : value;
}

// 16940n con escala 2 → "169.40".
export function formatDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const integer = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${integer}${scale > 0 ? `.${fraction}` : ''}`;
}

// División entera con redondeo comercial (la mitad se aleja del cero).
export function divideRoundingHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('División por cero.');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (n * 2n + d) / (d * 2n);
  return negative ? -quotient : quotient;
}

// División entera redondeada hacia abajo, para cantidades no negativas.
export function divideFloor(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n) throw new RangeError('Operandos fuera de rango.');
  return numerator / denominator;
}

export function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}
