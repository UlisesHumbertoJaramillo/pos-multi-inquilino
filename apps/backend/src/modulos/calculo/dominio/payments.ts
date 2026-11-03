// Pagos mixtos (T-115, T-116; RF-068 a RF-071, RF-122, D-17). Cada medio cubre una fracción del
// total de la venta, con su recargo o descuento calculado solo sobre esa fracción. El total a
// cobrar es la suma de las fracciones ajustadas.
import { DomainError } from '../../../compartido/dominio/errors.js';
import { cents, type Cents, money, percentOf, sum } from './rounding.js';

export interface FractionInput {
  id: string;
  // Solo el efectivo admite pagar de más y dar vuelto (RF-071).
  cash: boolean;
  // Recargo (positivo) o descuento (negativo) del método, en porcentaje.
  adjustmentPct: string;
  // Parte del total de la venta que cubre este medio.
  amount: string;
  // Lo que entregó el cliente con este medio; si se omite, lo justo.
  tendered?: string | null;
}

export interface FractionResult {
  id: string;
  amount: Cents;
  adjustment: Cents;
  // Lo que se cobra con este medio: fracción más su recargo o descuento.
  charged: Cents;
  tendered: Cents;
  change: Cents;
}

export interface PaymentPlan {
  fractions: FractionResult[];
  adjustment: Cents;
  totalToCharge: Cents;
  change: Cents;
}

// Recargo o descuento de cada fracción, sin validar lo entregado (para mostrar el total a cobrar
// mientras se arman los pagos).
export function adjustFractions(saleTotal: Cents, inputs: readonly FractionInput[]) {
  if (inputs.length === 0) {
    throw new DomainError('FRACCIONES_NO_CUADRAN', 'Falta indicar con qué se paga.');
  }
  const fractions = inputs.map((input) => {
    const amount = cents(input.amount, 'La fracción');
    if (amount <= 0n) {
      throw new DomainError('FRACCION_INVALIDA', 'Cada fracción tiene que ser mayor que cero.');
    }
    const adjustment = percentOf(amount, input.adjustmentPct);
    return { input, amount, adjustment, charged: amount + adjustment };
  });
  // RF-070: las fracciones tienen que cubrir exactamente el total de la venta.
  const assigned = sum(fractions.map((f) => f.amount));
  if (assigned !== saleTotal) {
    throw new DomainError(
      'FRACCIONES_NO_CUADRAN',
      `Las fracciones suman ${money(assigned)} y el total de la venta es ${money(saleTotal)}.`,
    );
  }
  return fractions;
}

// Plan de cobro validado (RF-070, RF-071): lo entregado con cada medio cubre su fracción ajustada;
// solo en efectivo se admite de más, y la diferencia es el vuelto.
export function planPayment(saleTotal: Cents, inputs: readonly FractionInput[]): PaymentPlan {
  const results = adjustFractions(saleTotal, inputs).map(
    ({ input, amount, adjustment, charged }) => {
      const tendered =
        input.tendered === undefined || input.tendered === null
          ? charged
          : cents(input.tendered, 'Lo entregado');
      if (tendered < charged) {
        throw new DomainError(
          'PAGO_INSUFICIENTE',
          `Lo entregado (${money(tendered)}) no cubre la fracción de ${money(charged)}.`,
        );
      }
      if (tendered > charged && !input.cash) {
        throw new DomainError(
          'PAGO_EXCEDIDO',
          'Solo con efectivo se puede pagar de más: con este medio se cobra exactamente su fracción.',
        );
      }
      return { id: input.id, amount, adjustment, charged, tendered, change: tendered - charged };
    },
  );
  return {
    fractions: results,
    adjustment: sum(results.map((f) => f.adjustment)),
    totalToCharge: sum(results.map((f) => f.charged)),
    change: sum(results.map((f) => f.change)),
  };
}
