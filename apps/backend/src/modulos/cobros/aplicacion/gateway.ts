// Puerto PasarelaDePagos y reglas de verificación (T-174, T-177, T-178; RF-075, RF-126, RF-127,
// AD-14). Cada intento lleva una clave de idempotencia: repetirla nunca genera otro cobro.

import { DomainError } from '../../../compartido/dominio/errors.js';

export { availableCredit, creditReference, paymentReference } from '../dominio/customers.js';

export type GatewayAnswer = 'aprobado' | 'rechazado' | 'sin_respuesta';
export type RefundAnswer = 'revertido' | 'rechazado' | 'sin_respuesta';

export interface GatewayResult {
  outcome: GatewayAnswer;
  reference: string | null;
}

export interface PaymentGateway {
  // Sin pasarela configurada, un cobro electrónico se rechaza antes de empezar.
  readonly configured: boolean;
  charge(input: {
    tenantId: string;
    key: string;
    amount: string;
    description: string;
  }): Promise<GatewayResult>;
  // Consulta el resultado real de un cobro (nunca se confía en lo que llega de afuera, AD-24).
  check(input: { tenantId: string; key: string }): Promise<GatewayResult>;
  refund(input: { tenantId: string; key: string }): Promise<{ outcome: RefundAnswer }>;
}

// Una falla de la integración es un resultado incierto, nunca un cobro exitoso (Const. 11).
export async function askGateway(call: () => Promise<GatewayResult>): Promise<GatewayResult> {
  try {
    return await call();
  } catch {
    return { outcome: 'sin_respuesta', reference: null };
  }
}

export async function askRefund(
  call: () => Promise<{ outcome: RefundAnswer }>,
): Promise<RefundAnswer> {
  try {
    return (await call()).outcome;
  } catch {
    return 'sin_respuesta';
  }
}

// Consultas sin respuesta antes de habilitar la resolución manual de un AS (RF-126).
export const MANUAL_AFTER_CHECKS = 3;
const FAST_CHECK_MS = 60_000;
const SLOW_CHECK_MS = 5 * 60_000;
const WATCH_MS = 24 * 60 * 60_000;

// Primero consultas seguidas; después, espaciadas durante un día. Así también se detecta una
// aprobación tardía de un pago ya resuelto a mano (RF-127).
export function nextVerification(startedAt: Date, checks: number, now: Date): Date | null {
  if (now.getTime() - startedAt.getTime() >= WATCH_MS) return null;
  return new Date(now.getTime() + (checks < MANUAL_AFTER_CHECKS ? FAST_CHECK_MS : SLOW_CHECK_MS));
}

// Alerta persistente al AS y al AC por un cobro aprobado que hay que devolver (RF-127).
export interface RefundAlerts {
  add(input: {
    tenantId: string;
    branchId: string;
    paymentId: string;
    detail: Record<string, unknown>;
    at: Date;
  }): Promise<void>;
}

export function assertGatewayConfigured(gateway: PaymentGateway): void {
  if (!gateway.configured) {
    throw new DomainError(
      'PASARELA_NO_CONFIGURADA',
      'Los pagos electrónicos todavía no están disponibles.',
    );
  }
}

export type PaymentType = 'efectivo' | 'electronico' | 'cuenta_corriente';

export interface PaymentMethod {
  id: string;
  name: string;
  type: PaymentType;
  adjustmentPct: string;
}
