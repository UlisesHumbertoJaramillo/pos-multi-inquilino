// Transferencias entre sucursales (T-093 a T-095; RF-044 a RF-047, RF-150, RF-151, D-36).
// El stock sale del disponible de origen al emitirse y queda en tránsito hasta que el destino lo
// recibe, lo rechaza o el origen cancela (S-4). Ninguna cantidad queda en tránsito para siempre.
import { DomainError } from '../../../compartido/dominio/errors.js';
import { fromUnits, normalizeNonNegative, normalizeQuantity, toUnits } from './stock.js';

export const TRANSFER_STATES = [
  'enviada',
  'recibida',
  'parcial',
  'rechazada',
  'cancelada',
] as const;
export type TransferState = (typeof TRANSFER_STATES)[number];

export const MAX_TRANSFER_ITEMS = 100;

export interface TransferItem {
  productId: string;
  sent: string;
  received: string | null;
  rejected: string | null;
  missing: string | null;
}

export interface Transfer {
  id: string;
  tenantId: string;
  originId: string;
  destinationId: string;
  state: TransferState;
  items: TransferItem[];
}

export function assertBranches(originId: string, destinationId: string): void {
  if (originId === destinationId) {
    throw new DomainError(
      'TRANSFERENCIA_INVALIDA',
      'La sucursal de origen y la de destino tienen que ser distintas.',
    );
  }
}

// Ítems a enviar: entre 1 y el máximo, sin productos repetidos, con cantidades válidas.
export function normalizeItems(
  items: readonly { productId: string; quantity: string }[],
): { productId: string; quantity: string }[] {
  if (items.length === 0 || items.length > MAX_TRANSFER_ITEMS) {
    throw new DomainError(
      'TRANSFERENCIA_INVALIDA',
      `Una transferencia lleva entre 1 y ${String(MAX_TRANSFER_ITEMS)} productos.`,
    );
  }
  const seen = new Set<string>();
  return items.map((item) => {
    if (seen.has(item.productId)) {
      throw new DomainError('TRANSFERENCIA_INVALIDA', 'Un producto aparece dos veces.');
    }
    seen.add(item.productId);
    return { productId: item.productId, quantity: normalizeQuantity(item.quantity) };
  });
}

export function assertPending(transfer: Transfer): void {
  if (transfer.state !== 'enviada') {
    throw new DomainError('TRANSFERENCIA_CERRADA', 'La transferencia ya fue cerrada.');
  }
}

export interface ReceptionLine {
  productId: string;
  received: string;
  rejected: string;
}

export interface ReceptionResult {
  items: TransferItem[];
  state: TransferState;
}

// Recepción en destino: por cada ítem, lo recibido y lo rechazado. El resto es faltante y va a
// merma (RF-045). No se puede recibir ni rechazar más de lo enviado (RF-150). Un ítem que no se
// informa se toma como faltante entero.
export function settleReception(
  transfer: Transfer,
  lines: readonly ReceptionLine[],
): ReceptionResult {
  assertPending(transfer);
  const byProduct = new Map<string, ReceptionLine>();
  for (const line of lines) {
    if (!transfer.items.some((item) => item.productId === line.productId)) {
      throw new DomainError(
        'RECEPCION_INVALIDA',
        'Se informó un producto que no está en la transferencia.',
      );
    }
    if (byProduct.has(line.productId)) {
      throw new DomainError('RECEPCION_INVALIDA', 'Un producto aparece dos veces.');
    }
    byProduct.set(line.productId, line);
  }

  const items = transfer.items.map((item) => {
    const line = byProduct.get(item.productId);
    const received = toUnits(normalizeNonNegative(line?.received ?? '0', 'Lo recibido'));
    const rejected = toUnits(normalizeNonNegative(line?.rejected ?? '0', 'Lo rechazado'));
    const sent = toUnits(item.sent);
    if (received + rejected > sent) {
      throw new DomainError(
        'RECEPCION_EXCEDIDA',
        'No se puede recibir ni rechazar más de lo que se envió.',
      );
    }
    return {
      ...item,
      received: fromUnits(received),
      rejected: fromUnits(rejected),
      missing: fromUnits(sent - received - rejected),
    };
  });
  return { items, state: closingState(items) };
}

// Rechazo total por el destino: todo vuelve al origen (RF-046).
export function settleRejection(transfer: Transfer): ReceptionResult {
  assertPending(transfer);
  return {
    items: transfer.items.map((item) => ({
      ...item,
      received: fromUnits(0n),
      rejected: item.sent,
      missing: fromUnits(0n),
    })),
    state: 'rechazada',
  };
}

function closingState(items: readonly TransferItem[]): TransferState {
  const total = (pick: (item: TransferItem) => string | null) =>
    items.reduce((sum, item) => sum + toUnits(pick(item) ?? '0'), 0n);
  const sent = total((item) => item.sent);
  if (total((item) => item.received) === sent) return 'recibida';
  if (total((item) => item.rejected) === sent) return 'rechazada';
  return 'parcial';
}
