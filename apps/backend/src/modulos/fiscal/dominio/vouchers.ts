// Reglas fiscales puras (T-192, T-195, T-197, T-203, T-204; RF-155, RF-160, RF-167, RF-168, D-53,
// D-56, D-59, D-87): tipo de comprobante, períodos del CAEA, reintentos y plazos.
import { DomainError } from '../../../compartido/dominio/errors.js';

export const ISSUER_CONDITIONS = ['responsable_inscripto', 'monotributista', 'exento'] as const;
export type IssuerCondition = (typeof ISSUER_CONDITIONS)[number];

export type VoucherClass = 'A' | 'B' | 'C';

// Sin comprador identificado se emite a consumidor final (RF-155). Un emisor que no discrimina IVA
// emite C; un responsable inscripto emite A a otro responsable inscripto y B al resto (D-87).
export function voucherClass(issuer: IssuerCondition, buyer: string | null): VoucherClass {
  if (issuer !== 'responsable_inscripto') return 'C';
  return buyer === 'responsable_inscripto' ? 'A' : 'B';
}

// El comprador que requiere factura A obliga a facturar la venta (RF-167).
export function requiresInvoiceA(issuer: IssuerCondition | null, buyer: string | null): boolean {
  return issuer !== null && voucherClass(issuer, buyer) === 'A';
}

export function normalizeCuit(value: string): string {
  const digits = value.replace(/[-\s]/g, '');
  if (!/^\d{11}$/.test(digits)) {
    throw new DomainError('CUIT_INVALIDO', 'El CUIT tiene que tener 11 dígitos.');
  }
  return digits;
}

export interface CaeaPeriod {
  code: string;
  from: string;
  to: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

// Quincena de una fecha AAAA-MM-DD: del 1 al 15 y del 16 a fin de mes.
export function caeaPeriodOf(date: string): CaeaPeriod {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
  const prefix = `${String(year)}${pad(month)}`;
  const base = `${String(year)}-${pad(month)}`;
  if (day <= 15) return { code: `${prefix}1`, from: `${base}-01`, to: `${base}-15` };
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { code: `${prefix}2`, from: `${base}-16`, to: `${base}-${pad(last)}` };
}

export function nextCaeaPeriod(period: CaeaPeriod): CaeaPeriod {
  const next = new Date(`${period.to}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return caeaPeriodOf(next.toISOString().slice(0, 10));
}

const DAY_MS = 24 * 60 * 60_000;

// El CAEA se pide con estos días de anticipación al período (RF-160).
export const CAEA_LEAD_DAYS = 5;

export function daysUntil(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / DAY_MS,
  );
}

// Espera creciente entre reintentos, hasta una hora.
export function nextAttempt(attempts: number, now: Date): Date {
  const minutes = Math.min(2 ** Math.min(attempts, 6), 60);
  return new Date(now.getTime() + minutes * 60_000);
}

export const REMINDER_MS = DAY_MS;

// Aviso al AC con esta anticipación al vencimiento del certificado (RF-162).
const CERTIFICATE_NOTICE_MS = 30 * DAY_MS;

export const certificateExpiresSoon = (expiresAt: Date, now: Date) =>
  expiresAt.getTime() - now.getTime() <= CERTIFICATE_NOTICE_MS;

// Facturación posterior (RF-168): el plazo cuenta en días desde la fecha de jornada de la venta;
// cero es la misma jornada (D-59).
export function assertWithinLaterInvoicing(journeyDate: string, days: number, today: string): void {
  if (daysUntil(journeyDate, today) > days) {
    throw new DomainError('PLAZO_FACTURACION_VENCIDO', 'Venció el plazo para facturar esta venta.');
  }
}
