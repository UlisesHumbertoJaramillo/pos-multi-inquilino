// Estado de los periféricos del POS (T-241; RF-016, RF-108, AD-16, D-92). Los periféricos están
// conectados al equipo del usuario: el frontend informa su estado y el backend lo deja en la
// auditoría técnica para el SA, sin ningún dato comercial.

export const DEVICES = ['impresora', 'lector'] as const;
export type Device = (typeof DEVICES)[number];

export const CONNECTIONS = ['usb', 'serial', 'navegador', 'teclado'] as const;
export type Connection = (typeof CONNECTIONS)[number];

export const STATES = ['ok', 'falla'] as const;
export type PeripheralState = (typeof STATES)[number];

// Motivos cerrados: nunca texto libre, para que no viaje nada comercial.
export const FAILURE_REASONS = [
  'sin_soporte',
  'sin_permiso',
  'desconectada',
  'error_envio',
  'sin_papel',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export interface PeripheralReport {
  device: Device;
  connection: Connection;
  state: PeripheralState;
  reason: FailureReason | null;
}

// Solo se registra un cambio de estado: informar dos veces el mismo no agrega nada.
export function isChange(
  previous: { state: PeripheralState; reason: FailureReason | null } | null,
  next: PeripheralReport,
): boolean {
  if (previous === null) return next.state === 'falla';
  return previous.state !== next.state || previous.reason !== next.reason;
}

// Un periférico que funciona no lleva motivo.
export function normalize(report: PeripheralReport): PeripheralReport {
  return report.state === 'ok' ? { ...report, reason: null } : report;
}
