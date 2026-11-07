// Devoluciones y anulaciones (T-215 a T-218; RF-081, RF-083, RF-084, RF-136, RF-138, D-27, D-31).
// Reglas puras: plazo, condiciones de la anulación y referencias de las autorizaciones.
import {
  formatDecimal,
  parseDecimal,
  pow10,
  QUANTITY_SCALE,
} from '../../../compartido/dominio/decimal.js';
import { DomainError } from '../../../compartido/dominio/errors.js';

// Unidades de un componente para una cantidad de combos.
export function componentQuantity(perCombo: string, combos: string): string {
  const total =
    (parseDecimal(perCombo, QUANTITY_SCALE) * parseDecimal(combos, QUANTITY_SCALE)) /
    pow10(QUANTITY_SCALE);
  return formatDecimal(total, QUANTITY_SCALE);
}

const DAY_MS = 24 * 60 * 60_000;

const daysBetween = (from: string, to: string) =>
  Math.round(
    (new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / DAY_MS,
  );

// El plazo cuenta en días desde la fecha de jornada de la venta (RF-138).
export function assertReturnWindow(journeyDate: string, days: number, today: string): void {
  if (daysBetween(journeyDate, today) > days) {
    throw new DomainError(
      'PLAZO_DEVOLUCION_VENCIDO',
      `Venció el plazo de devolución de ${String(days)} día(s).`,
    );
  }
}

const RETURN_INSTEAD = 'La venta no se puede anular: corresponde una devolución (RF-136).';

// Anular es cancelar la venta entera, en su mismo turno y sin devoluciones previas (D-27).
export function assertVoidable(input: {
  state: string;
  shiftOpen: boolean;
  sameShift: boolean;
  hasReturns: boolean;
  partial: boolean;
}): void {
  if (input.state !== 'confirmada') {
    throw new DomainError('VENTA_NO_ANULABLE', 'Solo se anula una venta confirmada.');
  }
  if (input.partial)
    throw new DomainError('CORRESPONDE_DEVOLUCION', `${RETURN_INSTEAD} Es parcial.`);
  if (!input.shiftOpen || !input.sameShift) {
    throw new DomainError(
      'CORRESPONDE_DEVOLUCION',
      `${RETURN_INSTEAD} Ya no está abierto el turno en que se vendió.`,
    );
  }
  if (input.hasReturns) {
    throw new DomainError('CORRESPONDE_DEVOLUCION', `${RETURN_INSTEAD} Ya tiene devoluciones.`);
  }
}

// La autorización de un reintegro en efectivo vale para esta venta y este monto (RF-081).
export const refundReference = (saleId: string, total: string) => `reembolso:${saleId}:${total}`;
export const voidReference = (saleId: string) => `anulacion:${saleId}`;
