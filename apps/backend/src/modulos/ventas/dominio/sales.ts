// Ventas del POS (T-146 a T-160; RF-030, RF-031, RF-053, RF-055, RF-058, RF-059, RF-077 a RF-079,
// RF-116, RF-153, D-81 a D-85). Reglas puras: estados, cantidades, inactividad, traspasos y
// decisión de facturar.
import {
  formatDecimal,
  parseDecimal,
  pow10,
  QUANTITY_SCALE,
  RATE_SCALE,
} from '../../../compartido/dominio/decimal.js';
import { DomainError } from '../../../compartido/dominio/errors.js';

export const COMMERCIAL_STATES = [
  'en_curso',
  'pago_por_verificar',
  'confirmada',
  'descartada',
  'anulada',
] as const;
export type CommercialState = (typeof COMMERCIAL_STATES)[number];

// Motivos de descarte que se conservan con la venta (RF-116).
export const DISCARD_REASONS = ['manual', 'inactividad', 'cierre_forzado', 'suspension'] as const;
export type DiscardReason = (typeof DISCARD_REASONS)[number];

export type BillingPolicy = 'siempre' | 'opcional_con_factura' | 'opcional_sin_factura';

export type DiscountType = 'porcentaje' | 'monto';

export interface ManualDiscountInput {
  type: DiscountType;
  value: string;
}

// Una venta solo se modifica mientras está en curso y sin un traspaso pendiente.
export function assertEditable(state: CommercialState, transferPending: boolean): void {
  if (state !== 'en_curso') {
    throw new DomainError('VENTA_NO_EDITABLE', 'La venta ya no está en curso.');
  }
  if (transferPending) {
    throw new DomainError(
      'TRASPASO_PENDIENTE',
      'La venta tiene un traspaso pendiente: esperá a que lo acepten o lo rechacen.',
    );
  }
}

// Cantidad de un ítem: mayor que cero, con hasta 3 decimales. Un combo se vende por unidades.
export function normalizeQuantity(value: string, combo: boolean): string {
  const quantity = parseDecimal(value, QUANTITY_SCALE, 'La cantidad');
  if (quantity <= 0n) {
    throw new DomainError('CANTIDAD_INVALIDA', 'La cantidad tiene que ser mayor que cero.');
  }
  if (combo && quantity % pow10(QUANTITY_SCALE) !== 0n) {
    throw new DomainError('CANTIDAD_INVALIDA', 'Un combo se vende por unidades enteras.');
  }
  return formatDecimal(quantity, QUANTITY_SCALE);
}

export function addQuantities(a: string, b: string): string {
  return formatDecimal(
    parseDecimal(a, QUANTITY_SCALE) + parseDecimal(b, QUANTITY_SCALE),
    QUANTITY_SCALE,
  );
}

// Diferencia entre la cantidad nueva y la actual: positiva hay que reservar, negativa liberar.
export function quantityDelta(current: string, next: string): string {
  return formatDecimal(
    parseDecimal(next, QUANTITY_SCALE) - parseDecimal(current, QUANTITY_SCALE),
    QUANTITY_SCALE,
  );
}

export const isPositive = (quantity: string) => parseDecimal(quantity, QUANTITY_SCALE) > 0n;

export function negate(quantity: string): string {
  return formatDecimal(-parseDecimal(quantity, QUANTITY_SCALE), QUANTITY_SCALE);
}

// Cantidad de un componente para N combos.
export function componentQuantity(perCombo: string, combos: string): string {
  const total =
    (parseDecimal(perCombo, QUANTITY_SCALE) * parseDecimal(combos, QUANTITY_SCALE)) /
    pow10(QUANTITY_SCALE);
  return formatDecimal(total, QUANTITY_SCALE);
}

// Un descuento manual: porcentaje entre 0 y 100, o monto no negativo (D-70).
export function normalizeDiscount(discount: ManualDiscountInput): ManualDiscountInput {
  if (discount.type === 'porcentaje') {
    const percent = parseDecimal(discount.value, RATE_SCALE, 'El porcentaje');
    if (percent < 0n || percent > 100n * pow10(RATE_SCALE)) {
      throw new DomainError('DESCUENTO_INVALIDO', 'El porcentaje tiene que estar entre 0 y 100.');
    }
    return { type: 'porcentaje', value: formatDecimal(percent, RATE_SCALE) };
  }
  const amount = parseDecimal(discount.value, 2, 'El monto');
  if (amount < 0n) {
    throw new DomainError('DESCUENTO_INVALIDO', 'El descuento no puede ser negativo.');
  }
  return { type: 'monto', value: formatDecimal(amount, 2) };
}

// Referencia de la autorización de un descuento fuera de cuota: liga el PIN a la venta. Vale por
// el monto que se autorizó: si el descuento cambia, la venta la pierde y hay que pedir otra.
export function discountReference(saleId: string): string {
  return `descuento:${saleId}`;
}

// Un carrito inactivo más allá del tiempo configurado se descarta (RF-059), salvo que tenga pagos
// aprobados o por verificar (D-19, D-20).
export function idleUntil(lastActivity: Date, idleMinutes: number): Date {
  return new Date(lastActivity.getTime() + idleMinutes * 60_000);
}

export function cartExpired(
  state: CommercialState,
  lastActivity: Date,
  idleMinutes: number,
  now: Date,
  hasLivePayments: boolean,
): boolean {
  if (state !== 'en_curso' || hasLivePayments) return false;
  return now.getTime() >= idleUntil(lastActivity, idleMinutes).getTime();
}

// Si la venta se factura (RF-165, RF-167, D-58): sin el módulo, nunca; con política "siempre",
// siempre; con una política opcional, lo que propone la política salvo que el VO lo cambie.
export function billingDecision(
  billingModule: boolean,
  policy: BillingPolicy,
  choice: boolean | null,
): boolean {
  if (!billingModule) return false;
  if (policy === 'siempre') return true;
  return choice ?? policy === 'opcional_con_factura';
}

// Un traspaso pendiente vence con el mismo tiempo de inactividad del carrito (RF-079).
export function transferExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}
