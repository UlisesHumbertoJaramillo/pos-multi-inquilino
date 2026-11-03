// Promociones automáticas con tipos cerrados y vigencia (T-120; RF-048, AD-17).
import {
  formatDecimal,
  MONEY_SCALE,
  parseDecimal,
  pow10,
  RATE_SCALE,
} from '../../../compartido/dominio/decimal.js';
import { DomainError } from '../../../compartido/dominio/errors.js';

export const PROMOTION_TYPES = ['nxm', 'porcentaje', 'precio_cantidad'] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];
export const PROMOTION_SCOPES = ['producto', 'categoria'] as const;
export type PromotionScope = (typeof PROMOTION_SCOPES)[number];

export type PromotionRule =
  | { type: 'nxm'; take: number; pay: number }
  | { type: 'porcentaje'; percent: string }
  | { type: 'precio_cantidad'; quantity: number; price: string };

export interface Promotion {
  id: string;
  tenantId: string;
  name: string;
  rule: PromotionRule;
  scope: PromotionScope;
  // El producto o la categoría, según el alcance.
  targetId: string;
  validFrom: Date;
  validUntil: Date;
  // Nulo: todas las sucursales.
  branchIds: string[] | null;
  isActive: boolean;
}

const MAX_UNITS = 100;

function units(value: number, what: string): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_UNITS) {
    throw new DomainError(
      'PROMOCION_INVALIDA',
      `${what} tiene que ser un número entero entre 1 y ${String(MAX_UNITS)}.`,
    );
  }
  return value;
}

export function assertPromotionName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw new DomainError(
      'PROMOCION_INVALIDA',
      'El nombre tiene que tener entre 1 y 80 caracteres.',
    );
  }
  return trimmed;
}

// Valida los parámetros de cada tipo (AD-17).
export function normalizeRule(rule: PromotionRule, scope: PromotionScope): PromotionRule {
  switch (rule.type) {
    case 'nxm': {
      const take = units(rule.take, 'Lo que se lleva');
      const pay = units(rule.pay, 'Lo que se paga');
      if (pay >= take) {
        throw new DomainError(
          'PROMOCION_INVALIDA',
          'En un NxM se paga menos de lo que se lleva (por ejemplo, 2x1).',
        );
      }
      return { type: 'nxm', take, pay };
    }
    case 'porcentaje': {
      const percent = parseDecimal(rule.percent, RATE_SCALE, 'El porcentaje');
      if (percent <= 0n || percent > 100n * pow10(RATE_SCALE)) {
        throw new DomainError(
          'PROMOCION_INVALIDA',
          'El porcentaje tiene que ser mayor que 0 y hasta 100.',
        );
      }
      return { type: 'porcentaje', percent: formatDecimal(percent, RATE_SCALE) };
    }
    case 'precio_cantidad': {
      // Un precio por N unidades se aplica a un producto: en una categoría, cada producto tiene
      // su propio precio de lista.
      if (scope !== 'producto') {
        throw new DomainError(
          'PROMOCION_INVALIDA',
          'El precio especial por cantidad se aplica a un producto.',
        );
      }
      const quantity = units(rule.quantity, 'La cantidad');
      if (quantity < 2) {
        throw new DomainError('PROMOCION_INVALIDA', 'El precio especial es para 2 unidades o más.');
      }
      const price = parseDecimal(rule.price, MONEY_SCALE, 'El precio');
      if (price <= 0n) {
        throw new DomainError(
          'PROMOCION_INVALIDA',
          'El precio especial tiene que ser mayor que cero.',
        );
      }
      return { type: 'precio_cantidad', quantity, price: formatDecimal(price, MONEY_SCALE) };
    }
  }
}

export function assertValidity(from: Date, until: Date): void {
  if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime()) || from >= until) {
    throw new DomainError(
      'VIGENCIA_INVALIDA',
      'La vigencia tiene que terminar después de empezar.',
    );
  }
}

// Vigente en ese momento y en esa sucursal.
export function isApplicable(promotion: Promotion, at: Date, branchId: string | null): boolean {
  return (
    promotion.isActive &&
    promotion.validFrom <= at &&
    at < promotion.validUntil &&
    (promotion.branchIds === null || branchId === null || promotion.branchIds.includes(branchId))
  );
}
