// Cuota de descuento (T-124 a T-127; RF-063 a RF-067, RF-142, D-32, D-72, D-73). Reglas puras:
// límites del tope y de cada cuota, recorte al bajar el tope, ajuste del saldo del día y control
// de un descuento manual contra la cuota.
import {
  formatDecimal,
  MONEY_SCALE,
  parseDecimal,
  pow10,
  RATE_SCALE,
} from '../../../compartido/dominio/decimal.js';
import { DomainError } from '../../../compartido/dominio/errors.js';

// Los dos límites de D-32: porcentaje máximo por venta y monto acumulado.
export interface QuotaLimits {
  percent: string;
  amount: string;
}

// Sin tope o sin cuota asignada, los límites son cero (D-72).
export const ZERO_LIMITS: QuotaLimits = { percent: '0.0000', amount: '0.00' };

const percentOf = (limits: QuotaLimits) =>
  parseDecimal(limits.percent, RATE_SCALE, 'El porcentaje');
const amountOf = (limits: QuotaLimits) => parseDecimal(limits.amount, MONEY_SCALE, 'El monto');
const money = (value: bigint) => formatDecimal(value, MONEY_SCALE);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

// Valida y normaliza los límites: porcentaje entre 0 y 100, monto no negativo.
export function normalizeLimits(limits: QuotaLimits): QuotaLimits {
  const percent = percentOf(limits);
  const amount = amountOf(limits);
  if (percent < 0n || percent > 100n * pow10(RATE_SCALE)) {
    throw new DomainError('CUOTA_INVALIDA', 'El porcentaje máximo tiene que estar entre 0 y 100.');
  }
  if (amount < 0n) {
    throw new DomainError('CUOTA_INVALIDA', 'El monto de la cuota no puede ser negativo.');
  }
  return { percent: formatDecimal(percent, RATE_SCALE), amount: money(amount) };
}

// Una cuota no supera ninguno de los dos límites del tope (RF-064).
export function assertWithinCap(quota: QuotaLimits, cap: QuotaLimits): void {
  if (percentOf(quota) > percentOf(cap) || amountOf(quota) > amountOf(cap)) {
    throw new DomainError(
      'CUOTA_SUPERA_TOPE',
      `La cuota no puede superar el tope del comercio (${cap.percent} % por venta y $ ${cap.amount}).`,
    );
  }
}

// Al bajar el tope, cada límite de la cuota se recorta al del tope (RF-142). Devuelve null si la
// cuota ya entra en el tope.
export function clampToCap(quota: QuotaLimits, cap: QuotaLimits): QuotaLimits | null {
  const percent = min(percentOf(quota), percentOf(cap));
  const amount = min(amountOf(quota), amountOf(cap));
  if (percent === percentOf(quota) && amount === amountOf(quota)) return null;
  return { percent: formatDecimal(percent, RATE_SCALE), amount: money(amount) };
}

// Cuando cambia el monto asignado, el saldo del día se ajusta por la diferencia y nunca queda
// negativo (D-73).
export function adjustedBalance(balance: string, previous: string, next: string): string {
  const value =
    parseDecimal(balance, MONEY_SCALE) +
    parseDecimal(next, MONEY_SCALE) -
    parseDecimal(previous, MONEY_SCALE);
  return money(value < 0n ? 0n : value);
}

// Descuento manual de una venta, ya calculado por el motor (D-70).
export interface DiscountRequest {
  // Subtotal después de promociones, sobre el que se aplica el descuento.
  subtotal: string;
  amount: string;
  // Porcentaje que ingresó el VO, si lo ingresó así. Si no, se calcula desde el monto.
  enteredPercent: string | null;
}

export type ExcessReason = 'porcentaje' | 'saldo';

export type QuotaCheck = { withinQuota: true } | { withinQuota: false; reasons: ExcessReason[] };

// Controla un descuento contra los dos límites de la cuota (RF-065, RF-066). El porcentaje
// ingresado se compara tal cual, para que el redondeo del monto no lo haga superar el máximo;
// un descuento en monto se compara con su proporción exacta sobre el subtotal.
export function checkDiscount(
  discount: DiscountRequest,
  quota: QuotaLimits,
  balance: string,
): QuotaCheck {
  const amount = parseDecimal(discount.amount, MONEY_SCALE, 'El descuento');
  const subtotal = parseDecimal(discount.subtotal, MONEY_SCALE, 'El subtotal');
  if (amount < 0n || amount > subtotal) {
    throw new DomainError(
      'DESCUENTO_INVALIDO',
      'El descuento no puede ser negativo ni superar el total de la venta.',
    );
  }
  const maxPercent = percentOf(quota);
  const overPercent =
    discount.enteredPercent === null
      ? amount * 100n * pow10(RATE_SCALE) > maxPercent * subtotal
      : parseDecimal(discount.enteredPercent, RATE_SCALE, 'El porcentaje') > maxPercent;
  const reasons: ExcessReason[] = [];
  if (overPercent) reasons.push('porcentaje');
  if (amount > parseDecimal(balance, MONEY_SCALE)) reasons.push('saldo');
  return reasons.length === 0 ? { withinQuota: true } : { withinQuota: false, reasons };
}

// Un AS no se asigna su propia cuota (Const. 13, D-74).
export function assertNotSelfAssigned(assignerId: string, sellerId: string): void {
  if (assignerId === sellerId) {
    throw new DomainError(
      'AUTOASIGNACION',
      'No podés asignarte tu propia cuota: la tiene que asignar otro AS de la sucursal.',
    );
  }
}
