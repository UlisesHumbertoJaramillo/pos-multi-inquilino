// Redondeo y prorrateo de D-17 (T-112; RF-123). Los montos son enteros en centavos (BigInt, escala
// 2 de decimal.ts): ningún cálculo usa coma flotante.
import {
  divideRoundingHalfUp,
  formatDecimal,
  MONEY_SCALE,
  parseDecimal,
  pow10,
  QUANTITY_SCALE,
  RATE_SCALE,
} from '../../../compartido/dominio/decimal.js';
import { DomainError } from '../../../compartido/dominio/errors.js';

export type Cents = bigint;

export const cents = (value: string, what = 'El monto'): Cents =>
  parseDecimal(value, MONEY_SCALE, what);
export const money = (value: Cents): string => formatDecimal(value, MONEY_SCALE);

// Cantidad × precio unitario, redondeado al centavo (la mitad hacia arriba).
export function lineAmount(quantity: string, unitPrice: string): Cents {
  return divideRoundingHalfUp(
    parseDecimal(quantity, QUANTITY_SCALE, 'La cantidad') * cents(unitPrice, 'El precio'),
    pow10(QUANTITY_SCALE),
  );
}

// Porcentaje (con signo) de un monto, redondeado al centavo: 10 % de 333 = 33,30.
export function percentOf(amount: Cents, percent: string): Cents {
  return divideRoundingHalfUp(
    amount * parseDecimal(percent, RATE_SCALE, 'El porcentaje'),
    100n * pow10(RATE_SCALE),
  );
}

// Prorratea `total` entre líneas según su peso (D-17). Cada parte se redondea al centavo y la
// diferencia de redondeo queda en la última línea, de modo que la suma es siempre el total.
//
// Se redondea el acumulado (no cada parte por separado): la parte i es
// redondeo(total × pesos hasta i / peso total) − redondeo(total × pesos hasta i−1 / peso total).
// Así ninguna parte queda negativa ni se aleja más de un centavo de su valor exacto, y la última
// es exactamente lo que falta para llegar al total.
export function allocate(total: Cents, weights: readonly Cents[]): Cents[] {
  if (weights.some((w) => w < 0n)) throw new RangeError('Los pesos no pueden ser negativos.');
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (weights.length === 0) {
    if (total !== 0n) throw new RangeError('No hay líneas entre las que repartir.');
    return [];
  }
  if (sum === 0n) {
    // Sin pesos: todo en la última línea.
    return weights.map((_, i) => (i === weights.length - 1 ? total : 0n));
  }
  let accumulated = 0n;
  let previous = 0n;
  return weights.map((weight, i) => {
    accumulated += weight;
    const upTo = i === weights.length - 1 ? total : divideRoundingHalfUp(total * accumulated, sum);
    const share = upTo - previous;
    previous = upTo;
    return share;
  });
}

export function sum(values: readonly Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0n);
}

export function assertNotNegative(value: Cents, code: string, message: string): void {
  if (value < 0n) throw new DomainError(code, message);
}
