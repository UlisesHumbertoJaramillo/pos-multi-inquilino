// Reintegro proporcional de una devolución (T-118; RF-085, RF-086, D-4, D-29). Se reintegra por
// cada medio de pago original la parte proporcional de lo que se cobró con él, recargo o
// descuento incluido. Las devoluciones parciales sucesivas usan el acumulado, así una devolución
// total devuelve exactamente lo cobrado.
import {
  divideRoundingHalfUp,
  parseDecimal,
  QUANTITY_SCALE,
} from '../../../compartido/dominio/decimal.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import { type Cents, sum } from './rounding.js';

// Parte de `amount` que corresponde a una proporción acumulada, menos lo que ya se tomó antes.
function proportionalStep(amount: Cents, before: bigint, now: bigint, whole: bigint): Cents {
  if (whole <= 0n) throw new RangeError('El total tiene que ser mayor que cero.');
  return (
    divideRoundingHalfUp(amount * (before + now), whole) -
    divideRoundingHalfUp(amount * before, whole)
  );
}

// Valor de las unidades devueltas de una línea: proporcional a su importe final.
export function returnedLineValue(
  lineFinal: Cents,
  quantitySold: string,
  returnedBefore: string,
  returningNow: string,
): Cents {
  const sold = parseDecimal(quantitySold, QUANTITY_SCALE);
  const before = parseDecimal(returnedBefore, QUANTITY_SCALE);
  const now = parseDecimal(returningNow, QUANTITY_SCALE, 'La cantidad a devolver');
  if (now <= 0n || before < 0n || before + now > sold) {
    throw new DomainError(
      'DEVOLUCION_EXCEDIDA',
      'No se puede devolver más de lo vendido (descontando lo ya devuelto).',
    );
  }
  return proportionalStep(lineFinal, before, now, sold);
}

export interface RefundFraction {
  id: string;
  creditAccount: boolean;
  charged: Cents;
}

// Reintegro por medio de pago: la proporción de lo devuelto sobre el total de la venta, aplicada
// a lo cobrado con cada medio (RF-085).
export function refundByFraction(
  saleTotal: Cents,
  fractions: readonly RefundFraction[],
  returnedBefore: Cents,
  returningNow: Cents,
): { id: string; creditAccount: boolean; refund: Cents }[] {
  if (returningNow <= 0n || returnedBefore < 0n || returnedBefore + returningNow > saleTotal) {
    throw new DomainError(
      'DEVOLUCION_EXCEDIDA',
      'Lo devuelto no puede superar el total de la venta.',
    );
  }
  return fractions.map((f) => ({
    id: f.id,
    creditAccount: f.creditAccount,
    refund: proportionalStep(f.charged, returnedBefore, returningNow, saleTotal),
  }));
}

// Lo que se devuelve de una fracción pagada con cuenta corriente (RF-086, D-29): baja el saldo
// del cliente hasta dejarlo en cero y el excedente se reintegra en efectivo, con autorización.
export function creditRefund(
  refund: Cents,
  customerBalance: Cents,
): { balanceReduction: Cents; cashExcess: Cents; requiresAuthorization: boolean } {
  const balanceReduction =
    customerBalance > 0n ? (refund < customerBalance ? refund : customerBalance) : 0n;
  const cashExcess = refund - balanceReduction;
  return { balanceReduction, cashExcess, requiresAuthorization: cashExcess > 0n };
}

export function totalRefund(parts: readonly { refund: Cents }[]): Cents {
  return sum(parts.map((p) => p.refund));
}
