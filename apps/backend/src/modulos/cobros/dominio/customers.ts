// Clientes y crédito (T-167, T-168; RF-072, RF-132, RF-144, D-24, D-35). Reglas puras.
import { formatDecimal, parseDecimal } from '../../../compartido/dominio/decimal.js';
import { DomainError } from '../../../compartido/dominio/errors.js';

const SCALE = 2;

export const FISCAL_CONDITIONS = [
  'consumidor_final',
  'responsable_inscripto',
  'monotributista',
  'exento',
] as const;
export type FiscalCondition = (typeof FISCAL_CONDITIONS)[number];

export interface CustomerInput {
  name: string;
  document: string | null;
  fiscalCondition: FiscalCondition;
}

export function normalizeCustomer(input: CustomerInput): CustomerInput {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 120) {
    throw new DomainError('CLIENTE_INVALIDO', 'La razón social es obligatoria (hasta 120 letras).');
  }
  const document = input.document?.trim() ?? '';
  if (document.length > 20) {
    throw new DomainError('CLIENTE_INVALIDO', 'El documento admite hasta 20 caracteres.');
  }
  return {
    name,
    document: document === '' ? null : document,
    fiscalCondition: input.fiscalCondition,
  };
}

export function normalizeCreditLimit(value: string): string {
  const limit = parseDecimal(value, SCALE, 'El límite de crédito');
  if (limit < 0n) {
    throw new DomainError('LIMITE_INVALIDO', 'El límite de crédito no puede ser negativo.');
  }
  return formatDecimal(limit, SCALE);
}

// Lo que el cliente todavía puede tomar a crédito; un saldo sobre el límite deja cero.
export function availableCredit(limit: string, balance: string): string {
  const available = parseDecimal(limit, SCALE) - parseDecimal(balance, SCALE);
  return formatDecimal(available > 0n ? available : 0n, SCALE);
}

// Un cliente con deuda conserva su cuenta: no se da de baja ni pierde la cuenta corriente.
export function assertNoDebt(balance: string): void {
  if (parseDecimal(balance, SCALE) > 0n) {
    throw new DomainError(
      'CLIENTE_CON_SALDO',
      `El cliente adeuda $ ${balance}: cobrá la deuda antes de hacer este cambio.`,
    );
  }
}

// Monto de un cobro de cuenta corriente: mayor que cero.
export function normalizeCollection(value: string): string {
  const amount = parseDecimal(value, SCALE, 'El monto');
  if (amount <= 0n) {
    throw new DomainError('MONTO_INVALIDO', 'El monto tiene que ser mayor que cero.');
  }
  return formatDecimal(amount, SCALE);
}

// La autorización de un exceso vale para esta venta y este total (RF-074).
export const creditReference = (saleId: string, total: string) => `credito:${saleId}:${total}`;

// Resolución manual de un pago por verificar: la autorización es de ese pago (RF-126).
export const paymentReference = (paymentId: string) => `pago:${paymentId}`;
