// Reglas de las alertas por destinatario (T-227; RF-041, RF-098, RF-127, D-51, D-91).
import { DomainError } from '../../../compartido/dominio/errors.js';
import type { Role } from '../../../compartido/dominio/roles.js';

export type AlertRole = Extract<Role, 'AC' | 'AS' | 'VO'>;
export type AlertSeverity = 'info' | 'advertencia' | 'critica';

const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 1, advertencia: 2, critica: 3 };

// Resumen para el indicador de todas las pantallas (RF-189): cuántas hay y la más grave.
export function summarize(severities: readonly AlertSeverity[]): {
  count: number;
  highest: AlertSeverity | null;
} {
  let highest: AlertSeverity | null = null;
  for (const severity of severities) {
    if (highest === null || SEVERITY_RANK[severity] > SEVERITY_RANK[highest]) highest = severity;
  }
  return { count: severities.length, highest };
}

// Se resuelven solas cuando el sistema corrige lo que las generó: nadie las puede descartar
// (D-38, D-51). Por ejemplo, el stock mínimo se rearma al reponer.
export const SELF_RESOLVING_ALERTS: readonly string[] = [
  'stock_minimo',
  'jornada_sin_z',
  'fiscal_sin_configurar',
  'fiscal_sin_caea',
  'caea_no_obtenido',
  'certificado_por_vencer',
  'comprobante_rechazado',
  'fiscal_plazo_vencido',
];

// Las persistentes sin resolver se recuerdan cada 24 horas, solo en la aplicación (D-91).
export const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const MAX_NOTE_LENGTH = 200;

export interface ResolvableAlert {
  type: string;
  severity: AlertSeverity;
  resolvedAt: Date | null;
}

// Quién ve una alerta: todos los del rol destinatario dentro de su ámbito (D-91). El AC ve las de
// todo el comercio; el AS y el VO, las de sus sucursales. Una alerta dirigida a una persona solo
// la ve esa persona.
export interface AlertAudience {
  role: AlertRole;
  userId: string;
  // Nulo: todas las sucursales del comercio (AC).
  branchIds: readonly string[] | null;
}

export interface AddressedAlert {
  recipientRole: AlertRole;
  recipientId: string | null;
  branchId: string | null;
}

export function isVisibleTo(alert: AddressedAlert, audience: AlertAudience): boolean {
  if (alert.recipientRole !== audience.role) return false;
  if (alert.recipientId !== null) return alert.recipientId === audience.userId;
  if (audience.branchIds === null) return true;
  return alert.branchId !== null && audience.branchIds.includes(alert.branchId);
}

// Resolver a mano: solo las que no se resuelven solas. Una crítica exige una nota con lo que se
// hizo (por ejemplo, el reintegro hecho por fuera de la pasarela).
export function assertResolvable(alert: ResolvableAlert, note: string | null): string | null {
  if (alert.resolvedAt !== null) {
    throw new DomainError('ALERTA_RESUELTA', 'La alerta ya está resuelta.');
  }
  if (SELF_RESOLVING_ALERTS.includes(alert.type)) {
    throw new DomainError(
      'ALERTA_NO_DESCARTABLE',
      'Esta alerta se resuelve sola cuando se corrige lo que la generó.',
    );
  }
  const trimmed = note?.trim() ?? '';
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw new DomainError(
      'NOTA_DEMASIADO_LARGA',
      `La nota admite hasta ${String(MAX_NOTE_LENGTH)} caracteres.`,
    );
  }
  if (alert.severity === 'critica' && trimmed.length === 0) {
    throw new DomainError(
      'NOTA_REQUERIDA',
      'Para resolver una alerta crítica, contá qué se hizo para corregirla.',
    );
  }
  return trimmed.length > 0 ? trimmed : null;
}

export function nextReminder(now: Date): Date {
  return new Date(now.getTime() + REMINDER_INTERVAL_MS);
}
