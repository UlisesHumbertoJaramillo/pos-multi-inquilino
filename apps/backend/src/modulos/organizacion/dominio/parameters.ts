// Parámetros del comercio dentro de los márgenes de la plataforma (RF-135, D-26).
// Los márgenes y valores por defecto son los de D-61. La tolerancia de arqueo 0 viene de D-51 y
// la facturación posterior en la misma jornada, de D-59.
import { DomainError } from '../../../compartido/dominio/errors.js';

export const BILLING_POLICIES = [
  'siempre',
  'opcional_con_factura',
  'opcional_sin_factura',
] as const;
export type BillingPolicy = (typeof BILLING_POLICIES)[number];

export interface TenantParameters {
  cartIdleMinutes: number;
  sessionIdleMinutes: number;
  fiscalRegularizationHours: number;
  returnWindowDays: number;
  // Monto en la moneda del comercio, con dos decimales.
  cashCountTolerance: string;
  billingPolicy: BillingPolicy;
  // 0 = dentro de la misma jornada (D-59).
  laterInvoicingDays: number;
}

type NumericField = Exclude<keyof TenantParameters, 'billingPolicy' | 'cashCountTolerance'>;

interface Margin {
  min: number;
  max: number;
  label: string;
  unit: string;
}

export const PLATFORM_MARGINS: Record<NumericField, Margin> = {
  cartIdleMinutes: { min: 2, max: 120, label: 'La inactividad del carrito', unit: 'minutos' },
  sessionIdleMinutes: { min: 5, max: 480, label: 'La inactividad de sesión', unit: 'minutos' },
  fiscalRegularizationHours: {
    min: 24,
    max: 240,
    label: 'El plazo de regularización fiscal',
    unit: 'horas',
  },
  returnWindowDays: { min: 0, max: 365, label: 'El plazo de devolución', unit: 'días' },
  laterInvoicingDays: { min: 0, max: 30, label: 'El plazo de facturación posterior', unit: 'días' },
};

export const MAX_CASH_COUNT_TOLERANCE = 100_000;

export const DEFAULT_PARAMETERS: TenantParameters = {
  cartIdleMinutes: 15,
  sessionIdleMinutes: 30,
  fiscalRegularizationHours: 72,
  returnWindowDays: 30,
  cashCountTolerance: '0.00',
  billingPolicy: 'siempre',
  laterInvoicingDays: 0,
};

function outOfRange(margin: Margin): DomainError {
  return new DomainError(
    'PARAMETRO_FUERA_DE_MARGEN',
    `${margin.label} tiene que estar entre ${String(margin.min)} y ${String(margin.max)} ${margin.unit}.`,
  );
}

// Aplica los cambios y verifica los márgenes. La política de facturación solo se puede cambiar
// con el módulo de facturación activo (RF-166).
export function applyParameterChanges(
  current: TenantParameters,
  changes: Partial<TenantParameters>,
  billingModuleActive: boolean,
): TenantParameters {
  const next = { ...current, ...changes };
  for (const [field, margin] of Object.entries(PLATFORM_MARGINS) as [NumericField, Margin][]) {
    const value = next[field];
    if (!Number.isInteger(value) || value < margin.min || value > margin.max) {
      throw outOfRange(margin);
    }
  }
  if (
    !/^\d+(\.\d{1,2})?$/.test(next.cashCountTolerance) ||
    Number(next.cashCountTolerance) > MAX_CASH_COUNT_TOLERANCE
  ) {
    throw new DomainError(
      'PARAMETRO_FUERA_DE_MARGEN',
      `La tolerancia de arqueo tiene que estar entre 0 y ${String(MAX_CASH_COUNT_TOLERANCE)}, con hasta dos decimales.`,
    );
  }
  next.cashCountTolerance = Number(next.cashCountTolerance).toFixed(2);
  if (
    changes.billingPolicy !== undefined &&
    changes.billingPolicy !== current.billingPolicy &&
    !billingModuleActive
  ) {
    throw new DomainError(
      'MODULO_FACTURACION_INACTIVO',
      'La política de facturación se configura con el módulo de facturación activo.',
    );
  }
  return next;
}
