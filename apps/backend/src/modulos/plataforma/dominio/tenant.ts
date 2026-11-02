// Comercio (tenant) y sus reglas (RF-013, RF-014, RF-134, RF-146, RF-147, RF-163, RF-164).
import { DomainError } from '../../../compartido/dominio/errors.js';

export type TenantStatus = 'activo' | 'suspendido' | 'baja';

export interface Tenant {
  id: string;
  name: string;
  cuit: string | null;
  currency: string;
  timezone: string;
  status: TenantStatus;
  hasOperations: boolean;
  billingModule: boolean;
  createdAt: Date;
}

// Comprobantes fiscales sin regularizar de un comercio (D-52, D-60).
export interface FiscalPending {
  queued: number;
  rejected: number;
  caeaNotReported: number;
}

export const NO_FISCAL_PENDING: FiscalPending = { queued: 0, rejected: 0, caeaNotReported: 0 };

export function hasFiscalPending(pending: FiscalPending): boolean {
  return pending.queued + pending.rejected + pending.caeaNotReported > 0;
}

export function describeFiscalPending(pending: FiscalPending): string {
  const parts = [
    pending.queued > 0 ? `${String(pending.queued)} en cola` : null,
    pending.rejected > 0 ? `${String(pending.rejected)} rechazado(s)` : null,
    pending.caeaNotReported > 0
      ? `${String(pending.caeaNotReported)} emitido(s) con CAEA sin informar`
      : null,
  ].filter((part) => part !== null);
  return parts.join(', ');
}

export function assertValidCurrency(currency: string): void {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new DomainError(
      'MONEDA_INVALIDA',
      'La moneda tiene que ser un código ISO 4217, como ARS.',
    );
  }
}

function isKnownTimezone(timezone: string): boolean {
  if (timezone.trim() === '' || timezone !== timezone.trim()) return false;
  try {
    new Intl.DateTimeFormat('es-AR', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function assertValidTimezone(timezone: string): void {
  // Acepta cualquier nombre IANA, incluidos los alias (America/Argentina/Cordoba).
  if (!isKnownTimezone(timezone)) {
    throw new DomainError(
      'ZONA_HORARIA_INVALIDA',
      'La zona horaria no es válida. Usá un nombre como America/Argentina/Buenos_Aires.',
    );
  }
}

// CUIT argentino: 11 dígitos, el último es verificador (módulo 11).
export function normalizeCuit(cuit: string): string {
  const digits = cuit.replace(/-/g, '');
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  if (!/^\d{11}$/.test(digits)) {
    throw new DomainError('CUIT_INVALIDO', 'El CUIT tiene que tener 11 dígitos.');
  }
  const sum = weights.reduce((total, weight, i) => total + weight * Number(digits[i]), 0);
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? 0 : remainder === 10 ? 9 : remainder;
  if (expected !== Number(digits[10])) {
    throw new DomainError('CUIT_INVALIDO', 'El CUIT no es válido: revisá el dígito verificador.');
  }
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

export function assertValidName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 120) {
    throw new DomainError('NOMBRE_INVALIDO', 'El nombre tiene que tener entre 1 y 120 caracteres.');
  }
  return trimmed;
}

function assertNotClosed(tenant: Tenant): void {
  if (tenant.status === 'baja') {
    throw new DomainError('COMERCIO_DADO_DE_BAJA', 'El comercio está dado de baja.');
  }
}

export interface TenantChanges {
  name?: string;
  cuit?: string | null;
  currency?: string;
  timezone?: string;
}

// RF-134: la moneda no cambia una vez que hay operaciones registradas.
export function applyChanges(tenant: Tenant, changes: TenantChanges): Tenant {
  assertNotClosed(tenant);
  const next = { ...tenant };
  if (changes.name !== undefined) next.name = assertValidName(changes.name);
  if (changes.cuit !== undefined)
    next.cuit = changes.cuit === null ? null : normalizeCuit(changes.cuit);
  if (changes.timezone !== undefined) {
    assertValidTimezone(changes.timezone);
    next.timezone = changes.timezone;
  }
  if (changes.currency !== undefined && changes.currency !== tenant.currency) {
    assertValidCurrency(changes.currency);
    if (tenant.hasOperations) {
      throw new DomainError(
        'MONEDA_BLOQUEADA',
        'No se puede cambiar la moneda de un comercio que ya tiene operaciones registradas.',
      );
    }
    next.currency = changes.currency;
  }
  return next;
}

export function suspend(tenant: Tenant): Tenant {
  if (tenant.status !== 'activo') {
    throw new DomainError('COMERCIO_NO_ACTIVO', 'Solo se puede suspender un comercio activo.');
  }
  return { ...tenant, status: 'suspendido' };
}

export function reactivate(tenant: Tenant): Tenant {
  if (tenant.status !== 'suspendido') {
    throw new DomainError(
      'COMERCIO_NO_SUSPENDIDO',
      'Solo se puede reactivar un comercio suspendido.',
    );
  }
  return { ...tenant, status: 'activo' };
}

// RF-147, D-52: baja lógica solo sin comprobantes fiscales por regularizar.
export function close(tenant: Tenant, pending: FiscalPending): Tenant {
  assertNotClosed(tenant);
  if (hasFiscalPending(pending)) {
    throw new DomainError(
      'COMPROBANTES_PENDIENTES',
      `No se puede dar de baja: hay comprobantes sin regularizar (${describeFiscalPending(pending)}).`,
    );
  }
  return { ...tenant, status: 'baja' };
}

// RF-163, RF-164, D-60: desactivar el módulo exige no tener comprobantes sin regularizar.
export function setBillingModule(tenant: Tenant, active: boolean, pending: FiscalPending): Tenant {
  assertNotClosed(tenant);
  if (!active && tenant.billingModule && hasFiscalPending(pending)) {
    throw new DomainError(
      'MODULO_CON_PENDIENTES',
      `No se puede desactivar la facturación: hay comprobantes sin regularizar (${describeFiscalPending(pending)}).`,
    );
  }
  return { ...tenant, billingModule: active };
}
