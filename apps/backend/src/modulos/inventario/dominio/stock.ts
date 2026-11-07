// Saldos de stock y sus operaciones (T-089 a T-092, T-096; RF-039 a RF-043, RF-088).
// Cada operación mueve una cantidad entre dos estados del saldo (o la hace entrar o salir del
// inventario) y deja su movimiento en el libro mayor (AD-09).
import {
  formatDecimal,
  parseDecimal,
  pow10,
  QUANTITY_SCALE,
} from '../../../compartido/dominio/decimal.js';
import { DomainError } from '../../../compartido/dominio/errors.js';

export const STOCK_STATES = ['disponible', 'reservado', 'en_revision', 'en_transito'] as const;
export type StockState = (typeof STOCK_STATES)[number];

export type MovementType =
  | 'ingreso'
  | 'ajuste'
  | 'merma'
  | 'reserva'
  | 'liberacion'
  | 'venta'
  | 'transferencia'
  | 'recepcion'
  | 'rechazo'
  | 'cancelacion'
  | 'devolucion'
  | 'reingreso'
  | 'anulacion';

// Una operación: de qué estado sale la cantidad y a cuál entra. Nulo: fuera del inventario.
export interface StockOperation {
  type: MovementType;
  from: StockState | null;
  to: StockState | null;
}

// Operaciones atómicas que ofrece el inventario a los demás módulos (plan §2.7).
export const OPERATIONS = {
  // Entra mercadería: recepción de una compra o ajuste positivo.
  ingresar: { type: 'ingreso', from: null, to: 'disponible' },
  ajustarSuma: { type: 'ajuste', from: null, to: 'disponible' },
  ajustarResta: { type: 'ajuste', from: 'disponible', to: null },
  // Venta en curso (RF-055 a RF-057).
  reservar: { type: 'reserva', from: 'disponible', to: 'reservado' },
  liberar: { type: 'liberacion', from: 'reservado', to: 'disponible' },
  consumir: { type: 'venta', from: 'reservado', to: null },
  // Mermas (RF-042) y resolución de ítems en revisión (RF-088).
  mermar: { type: 'merma', from: 'disponible', to: null },
  pasarARevision: { type: 'devolucion', from: null, to: 'en_revision' },
  // Anulación de una venta: lo vendido vuelve al disponible (RF-082).
  reponer: { type: 'anulacion', from: null, to: 'disponible' },
  reingresar: { type: 'reingreso', from: 'en_revision', to: 'disponible' },
  mermarRevision: { type: 'merma', from: 'en_revision', to: null },
  // Transferencias (RF-044 a RF-046, RF-151). El tránsito se lleva en la sucursal de origen.
  pasarATransito: { type: 'transferencia', from: 'disponible', to: 'en_transito' },
  salirDeTransito: { type: 'recepcion', from: 'en_transito', to: null },
  recibirTransferencia: { type: 'recepcion', from: null, to: 'disponible' },
  mermarTransito: { type: 'merma', from: 'en_transito', to: null },
  rechazarTransferencia: { type: 'rechazo', from: 'en_transito', to: 'disponible' },
  cancelarTransferencia: { type: 'cancelacion', from: 'en_transito', to: 'disponible' },
} as const satisfies Record<string, StockOperation>;

export type OperationName = keyof typeof OPERATIONS;

export const WASTE_REASONS = ['rotura', 'vencimiento', 'perdida'] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];

// Motivo de la merma por faltante al recibir una transferencia (D-36).
export const TRANSIT_LOSS_REASON = 'perdida_en_transito';

export interface StockBalance {
  productId: string;
  available: string;
  reserved: string;
  inReview: string;
  inTransit: string;
  minimum: string | null;
  alertActive: boolean;
}

const MAX_QUANTITY = pow10(9 + QUANTITY_SCALE);

export function toUnits(value: string, what = 'La cantidad'): bigint {
  return parseDecimal(value, QUANTITY_SCALE, what);
}

export function fromUnits(value: bigint): string {
  return formatDecimal(value, QUANTITY_SCALE);
}

// Cantidad de una operación: mayor que cero, con hasta 3 decimales.
export function normalizeQuantity(value: string, what = 'La cantidad'): string {
  const units = toUnits(value, what);
  if (units <= 0n || units >= MAX_QUANTITY) {
    throw new DomainError('CANTIDAD_INVALIDA', `${what} tiene que ser mayor que cero.`);
  }
  return fromUnits(units);
}

// Cantidad que puede ser cero (una recepción sin faltante, por ejemplo).
export function normalizeNonNegative(value: string, what: string): string {
  const units = toUnits(value, what);
  if (units < 0n || units >= MAX_QUANTITY) {
    throw new DomainError('CANTIDAD_INVALIDA', `${what} no puede ser negativa.`);
  }
  return fromUnits(units);
}

// Ajuste con signo: "+5" o "-2.5". Devuelve la operación y la cantidad positiva.
export function adjustmentOperation(delta: string): { operation: OperationName; quantity: string } {
  const units = toUnits(delta, 'El ajuste');
  if (units === 0n || units >= MAX_QUANTITY || -units >= MAX_QUANTITY) {
    throw new DomainError('CANTIDAD_INVALIDA', 'El ajuste no puede ser cero.');
  }
  return units > 0n
    ? { operation: 'ajustarSuma', quantity: fromUnits(units) }
    : { operation: 'ajustarResta', quantity: fromUnits(-units) };
}

export function normalizeMinimum(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  return normalizeNonNegative(value, 'El umbral mínimo');
}

export function assertReason(reason: string, what = 'El motivo'): string {
  const trimmed = reason.trim();
  if (trimmed.length < 3 || trimmed.length > 200) {
    throw new DomainError('MOTIVO_INVALIDO', `${what} tiene que tener entre 3 y 200 caracteres.`);
  }
  return trimmed;
}

// El saldo de origen no alcanza: la actualización condicional no afectó ninguna fila (AD-04).
// RF-043 para ajustes y mermas, RF-057 para reservas.
export function insufficientStock(from: StockState, productName: string): DomainError {
  const what: Record<StockState, string> = {
    disponible: 'stock disponible',
    reservado: 'stock reservado',
    en_revision: 'stock en revisión',
    en_transito: 'stock en tránsito',
  };
  return new DomainError(
    'STOCK_INSUFICIENTE',
    `No hay ${what[from]} suficiente de «${productName}» para esta operación.`,
  );
}

// Alerta de stock mínimo una vez por cruce del umbral (RF-041, D-51): se emite al quedar el
// disponible por debajo del umbral y se rearma cuando lo vuelve a alcanzar.
export type ThresholdTransition = 'emit' | 'rearm' | 'none';

export function thresholdTransition(
  available: string,
  minimum: string | null,
  alertActive: boolean,
): ThresholdTransition {
  const below = minimum !== null && toUnits(available) < toUnits(minimum);
  if (below && !alertActive) return 'emit';
  if (!below && alertActive) return 'rearm';
  return 'none';
}
