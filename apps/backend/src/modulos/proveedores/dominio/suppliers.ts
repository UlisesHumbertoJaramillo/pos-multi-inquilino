// Proveedores, compras y pagos (T-105, T-107 a T-109; RF-034, RF-036 a RF-038, RF-133).
import {
  divideRoundingHalfUp,
  formatDecimal,
  MONEY_SCALE,
  parseDecimal,
  pow10,
  QUANTITY_SCALE,
} from '../../../compartido/dominio/decimal.js';
import { DomainError } from '../../../compartido/dominio/errors.js';

export interface Supplier {
  id: string;
  tenantId: string;
  name: string;
  cuit: string | null;
  contact: string | null;
  balance: string;
  isActive: boolean;
}

export function assertSupplierName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 120) {
    throw new DomainError(
      'RAZON_SOCIAL_INVALIDA',
      'La razón social tiene que tener entre 1 y 120 caracteres.',
    );
  }
  return trimmed;
}

// CUIT de 11 dígitos con su dígito verificador; se aceptan guiones. Vacío: sin CUIT.
export function normalizeCuit(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  const digits = value.replace(/[-\s]/g, '');
  const invalid = () =>
    new DomainError('CUIT_INVALIDO', 'El CUIT tiene que tener 11 dígitos válidos.');
  if (!/^\d{11}$/.test(digits)) throw invalid();
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, i) => total + weight * Number(digits[i]), 0);
  const remainder = 11 - (sum % 11);
  const check = remainder === 11 ? 0 : remainder === 10 ? 9 : remainder;
  if (check !== Number(digits[10])) throw invalid();
  return digits;
}

export function normalizeContact(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    throw new DomainError('CONTACTO_INVALIDO', 'El contacto tiene hasta 200 caracteres.');
  }
  return trimmed;
}

// Un proveedor con saldo no se da de baja (RF-148).
export function assertNoBalance(supplier: Supplier): void {
  if (parseDecimal(supplier.balance, MONEY_SCALE) !== 0n) {
    throw new DomainError(
      'BAJA_CON_DEPENDENCIAS',
      `No se puede dar de baja el proveedor: tiene un saldo de ${supplier.balance}.`,
    );
  }
}

export const MAX_PURCHASE_ITEMS = 200;

export interface PurchaseLine {
  productId: string;
  quantity: string;
  unitCost: string;
  subtotal: string;
}

// Ítems de una compra: cantidades con 3 decimales, costos sin IVA con 2, subtotal redondeado al
// centavo. El total es la suma de los subtotales.
export function purchaseLines(
  items: readonly { productId: string; quantity: string; unitCost: string }[],
): { lines: PurchaseLine[]; total: string } {
  if (items.length === 0 || items.length > MAX_PURCHASE_ITEMS) {
    throw new DomainError(
      'COMPRA_INVALIDA',
      `Una compra lleva entre 1 y ${String(MAX_PURCHASE_ITEMS)} productos.`,
    );
  }
  const seen = new Set<string>();
  let total = 0n;
  const lines = items.map((item) => {
    if (seen.has(item.productId)) {
      throw new DomainError('COMPRA_INVALIDA', 'Un producto aparece dos veces en la compra.');
    }
    seen.add(item.productId);
    const quantity = parseDecimal(item.quantity, QUANTITY_SCALE, 'La cantidad');
    if (quantity <= 0n || quantity >= pow10(9 + QUANTITY_SCALE)) {
      throw new DomainError('CANTIDAD_INVALIDA', 'La cantidad tiene que ser mayor que cero.');
    }
    const cost = parseDecimal(item.unitCost, MONEY_SCALE, 'El costo unitario');
    if (cost < 0n || cost >= pow10(12 + MONEY_SCALE)) {
      throw new DomainError('COSTO_INVALIDO', 'El costo unitario no puede ser negativo.');
    }
    const subtotal = divideRoundingHalfUp(quantity * cost, pow10(QUANTITY_SCALE));
    total += subtotal;
    return {
      productId: item.productId,
      quantity: formatDecimal(quantity, QUANTITY_SCALE),
      unitCost: formatDecimal(cost, MONEY_SCALE),
      subtotal: formatDecimal(subtotal, MONEY_SCALE),
    };
  });
  return { lines, total: formatDecimal(total, MONEY_SCALE) };
}

export interface ReceivedLine {
  itemId: string;
  productId: string;
  received: string;
  difference: string;
}

// Recepción (RF-133): no se recibe más de lo comprado; la diferencia queda registrada. Un ítem
// que no se informa se toma como no recibido.
export function settlePurchaseReception(
  items: readonly { itemId: string; productId: string; quantity: string }[],
  received: readonly { productId: string; quantity: string }[],
): ReceivedLine[] {
  const byProduct = new Map<string, string>();
  for (const line of received) {
    if (!items.some((item) => item.productId === line.productId)) {
      throw new DomainError(
        'RECEPCION_INVALIDA',
        'Se informó un producto que no está en la compra.',
      );
    }
    if (byProduct.has(line.productId)) {
      throw new DomainError('RECEPCION_INVALIDA', 'Un producto aparece dos veces.');
    }
    byProduct.set(line.productId, line.quantity);
  }
  return items.map((item) => {
    const bought = parseDecimal(item.quantity, QUANTITY_SCALE);
    const got = parseDecimal(byProduct.get(item.productId) ?? '0', QUANTITY_SCALE, 'Lo recibido');
    if (got < 0n) {
      throw new DomainError('CANTIDAD_INVALIDA', 'Lo recibido no puede ser negativo.');
    }
    if (got > bought) {
      throw new DomainError('RECEPCION_EXCEDIDA', 'No se puede recibir más de lo que se compró.');
    }
    return {
      itemId: item.itemId,
      productId: item.productId,
      received: formatDecimal(got, QUANTITY_SCALE),
      difference: formatDecimal(bought - got, QUANTITY_SCALE),
    };
  });
}

export const PAYMENT_METHODS = ['efectivo', 'transferencia', 'cheque', 'otro'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function normalizeAmount(value: string): string {
  const amount = parseDecimal(value, MONEY_SCALE, 'El monto');
  if (amount <= 0n || amount >= pow10(12 + MONEY_SCALE)) {
    throw new DomainError('MONTO_INVALIDO', 'El monto tiene que ser mayor que cero.');
  }
  return formatDecimal(amount, MONEY_SCALE);
}

export function assertReference(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 60) {
    throw new DomainError(
      'COMPROBANTE_INVALIDO',
      'El comprobante de referencia tiene entre 1 y 60 caracteres.',
    );
  }
  return trimmed;
}

// Un pago que supera el saldo adeudado exige una confirmación explícita (RF-038).
export function assertPaymentWithinBalance(
  balance: string,
  amount: string,
  confirmed: boolean,
): { exceeds: boolean } {
  const exceeds = parseDecimal(amount, MONEY_SCALE) > parseDecimal(balance, MONEY_SCALE);
  if (exceeds && !confirmed) {
    throw new DomainError(
      'PAGO_EXCEDE_DEUDA',
      `El pago de ${amount} supera el saldo adeudado de ${balance}. Confirmá el pago para registrarlo igual.`,
    );
  }
  return { exceeds };
}

export function negate(amount: string): string {
  return formatDecimal(-parseDecimal(amount, MONEY_SCALE), MONEY_SCALE);
}
