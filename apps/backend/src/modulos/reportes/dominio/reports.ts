// Reglas de los reportes (T-232 a T-235; RF-107, RF-109 a RF-111, D-50, D-91).
// Los reportes agrupan por fecha de jornada (RF-118). Las ventas se informan brutas, y las
// devoluciones y anulaciones aparte (D-91).
import {
  divideRoundingHalfUp,
  formatDecimal,
  MONEY_SCALE,
  parseDecimal,
} from '../../../compartido/dominio/decimal.js';
import { DomainError } from '../../../compartido/dominio/errors.js';

export const MAX_PERIOD_DAYS = 366;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

// Fecha calendario en la zona horaria del comercio (AAAA-MM-DD).
export function dateIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(at);
}

function dayNumber(day: string): number {
  const time = Date.parse(`${day}T00:00:00Z`);
  if (!DAY.test(day) || Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day) {
    throw new DomainError('FECHA_INVALIDA', `«${day}» no es una fecha válida (AAAA-MM-DD).`);
  }
  return time / DAY_MS;
}

export function assertDay(day: string): string {
  dayNumber(day);
  return day;
}

export interface Period {
  from: string;
  to: string;
}

// Período inclusivo, de hasta un año.
export function assertPeriod(period: Period): Period {
  const from = dayNumber(period.from);
  const to = dayNumber(period.to);
  if (from > to) {
    throw new DomainError('PERIODO_INVALIDO', 'La fecha inicial es posterior a la final.');
  }
  if (to - from + 1 > MAX_PERIOD_DAYS) {
    throw new DomainError(
      'PERIODO_DEMASIADO_LARGO',
      `El período puede abarcar hasta ${String(MAX_PERIOD_DAYS)} días.`,
    );
  }
  return period;
}

// Últimos 30 días hasta hoy, si no se indica un período.
export function defaultPeriod(today: string): Period {
  const to = dayNumber(today);
  const from = new Date((to - 29) * DAY_MS).toISOString().slice(0, 10);
  return { from, to: today };
}

// Ticket promedio: total bruto sobre cantidad de tickets, redondeado al centavo.
export function averageTicket(total: string, tickets: number): string {
  if (tickets === 0) return formatDecimal(0n, MONEY_SCALE);
  return formatDecimal(
    divideRoundingHalfUp(parseDecimal(total, MONEY_SCALE), BigInt(tickets)),
    MONEY_SCALE,
  );
}

// Identificación del ticket (RF-107, D-57, D-58): comprobante fiscal, factura en trámite o ticket
// no válido como factura.
export type TicketIdentification =
  'comprobante_fiscal' | 'factura_en_tramite' | 'no_valido_como_factura';

export interface TicketFiscalState {
  billed: boolean;
  voucher: { state: string; nonFiscal: boolean; authorized: boolean } | null;
}

export function ticketIdentification(state: TicketFiscalState): TicketIdentification {
  const voucher = state.voucher;
  if (!state.billed || voucher === null) {
    return state.billed ? 'factura_en_tramite' : 'no_valido_como_factura';
  }
  if (voucher.nonFiscal) return 'no_valido_como_factura';
  if (voucher.state === 'aceptado' && voucher.authorized) return 'comprobante_fiscal';
  return 'factura_en_tramite';
}

export const TICKET_LEGENDS: Record<TicketIdentification, string> = {
  comprobante_fiscal: 'Comprobante fiscal autorizado.',
  factura_en_tramite: 'Factura en trámite con ARCA: el comprobante fiscal se emite al autorizarse.',
  no_valido_como_factura: 'Ticket no válido como factura.',
};
