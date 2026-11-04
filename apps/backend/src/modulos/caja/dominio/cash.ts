// Caja (T-130 a T-140; RF-089 a RF-099, RF-112, RF-118, D-75 a D-78). Reglas puras: fecha y
// vencimiento de la jornada, saldo teórico de efectivo, arqueo, tolerancia y movimientos manuales.
import { formatDecimal, MONEY_SCALE, parseDecimal } from '../../../compartido/dominio/decimal.js';
import { DomainError } from '../../../compartido/dominio/errors.js';

export const MOVEMENT_TYPES = [
  'ingreso',
  'retiro',
  'venta',
  'reintegro',
  'cobro',
  'anulacion',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

// Sentido de cada tipo de movimiento en el efectivo de la caja.
const SIGN: Record<MovementType, 1n | -1n> = {
  ingreso: 1n,
  venta: 1n,
  cobro: 1n,
  retiro: -1n,
  reintegro: -1n,
  anulacion: -1n,
};

export interface CashMovement {
  type: MovementType;
  amount: string;
  inCash: boolean;
}

export type CountResult = 'faltante' | 'sobrante' | 'cuadrado';

export interface CashCount {
  declared: string;
  theoretical: string;
  difference: string;
  result: CountResult;
}

// Una jornada abierta se continúa hasta 24 h después de su apertura; pasado ese plazo, la caja
// exige el Corte Z antes de abrir otro turno (RF-097, D-77).
export const JOURNEY_MAX_HOURS = 24;

const money = (value: bigint) => formatDecimal(value, MONEY_SCALE);
const cents = (value: string, what = 'El monto') => parseDecimal(value, MONEY_SCALE, what);

// Fecha de la jornada: la de apertura en la zona horaria del comercio (RF-118).
export function journeyDate(at: Date, timeZone: string): string {
  // en-CA formatea como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export function journeyExpired(openedAt: Date, now: Date): boolean {
  return now.getTime() - openedAt.getTime() >= JOURNEY_MAX_HOURS * 3_600_000;
}

// Monto declarado o de un movimiento: no negativo, con hasta 2 decimales.
export function normalizeAmount(value: string, what: string, allowZero: boolean): string {
  const amount = cents(value, what);
  if (amount < 0n || (!allowZero && amount === 0n)) {
    throw new DomainError(
      'MONTO_INVALIDO',
      allowZero ? `${what} no puede ser negativo.` : `${what} tiene que ser mayor que cero.`,
    );
  }
  return money(amount);
}

// Motivo obligatorio de un ingreso o un retiro manual (RF-091).
export function normalizeReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    throw new DomainError('MOTIVO_INVALIDO', 'Indicá el motivo, con hasta 200 caracteres.');
  }
  return trimmed;
}

// Saldo teórico de efectivo: el saldo inicial más los movimientos en efectivo (RF-112).
export function theoreticalCash(initial: string, movements: readonly CashMovement[]): string {
  let total = cents(initial);
  for (const m of movements) {
    if (m.inCash) total += SIGN[m.type] * cents(m.amount);
  }
  return money(total);
}

// Arqueo: lo declarado contra el teórico (RF-094, RF-095).
export function countCash(declared: string, theoretical: string): CashCount {
  const difference = cents(declared) - cents(theoretical);
  return {
    declared: money(cents(declared)),
    theoretical: money(cents(theoretical)),
    difference: money(difference),
    result: difference < 0n ? 'faltante' : difference > 0n ? 'sobrante' : 'cuadrado',
  };
}

// Una diferencia notifica si supera la tolerancia del comercio (RF-098).
export function exceedsTolerance(difference: string, tolerance: string): boolean {
  const value = cents(difference);
  return (value < 0n ? -value : value) > cents(tolerance);
}

// Diferencia entre el saldo inicial declarado y lo que declaró el turno anterior de la jornada
// (RF-089, D-75). El primer turno de la jornada no tiene con qué compararse.
export function openingDifference(declared: string, previous: string | null): string | null {
  if (previous === null) return null;
  const difference = cents(declared) - cents(previous);
  return difference === 0n ? null : money(difference);
}

// Un retiro no puede superar el efectivo teórico del turno (RF-092).
export function withdrawalCovered(amount: string, theoretical: string): boolean {
  return cents(amount) <= cents(theoretical);
}

// Referencia de la autorización de un retiro: liga el PIN al turno y al monto, para que no sirva
// para retirar otro importe.
export function withdrawalReference(shiftId: string, amount: string): string {
  return `retiro:${shiftId}:${amount}`;
}
