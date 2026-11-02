// Reglas de cálculo de una lista de precios (T-076; RF-028, RF-032, RF-120).
// Los precios de lista son finales, con IVA incluido (D-16). El costo se carga sin IVA:
// precio = costo × (1 + margen) × (1 + IVA de la categoría), redondeado al centavo.
// Decisión de negocio confirmada con el comercio (Fase 4).
import {
  divideRoundingHalfUp,
  formatDecimal,
  MONEY_SCALE,
  parseDecimal,
  pow10,
  RATE_SCALE,
} from '../../../compartido/dominio/decimal.js';
import { DomainError } from '../../../compartido/dominio/errors.js';

export const PRICE_RULES = ['fijo', 'porcentaje_costo', 'por_grupo'] as const;
export type PriceRuleType = (typeof PRICE_RULES)[number];

// Margen admitido sobre el costo, en porcentaje. Un margen negativo vende por debajo del costo.
export const MARKUP_MARGIN = { min: -90, max: 1000 } as const;

export type PriceRule =
  // El AC carga el precio de cada producto a mano.
  | { type: 'fijo' }
  // Un mismo margen sobre el costo para todo el catálogo.
  | { type: 'porcentaje_costo'; markupPct: string }
  // Un margen por categoría, con un margen por defecto para las demás.
  | { type: 'por_grupo'; markupPct: string; byCategory: Readonly<Record<string, string>> };

// Normaliza un margen ("40" → "40.0000") y lo valida.
export function normalizeMarkup(value: string): string {
  const scaled = parseDecimal(value, RATE_SCALE, 'El margen');
  const unit = pow10(RATE_SCALE);
  if (scaled < BigInt(MARKUP_MARGIN.min) * unit || scaled > BigInt(MARKUP_MARGIN.max) * unit) {
    throw new DomainError(
      'MARGEN_FUERA_DE_RANGO',
      `El margen tiene que estar entre ${String(MARKUP_MARGIN.min)}% y ${String(MARKUP_MARGIN.max)}%.`,
    );
  }
  return formatDecimal(scaled, RATE_SCALE);
}

export function normalizeRule(rule: PriceRule): PriceRule {
  switch (rule.type) {
    case 'fijo':
      return { type: 'fijo' };
    case 'porcentaje_costo':
      return { type: 'porcentaje_costo', markupPct: normalizeMarkup(rule.markupPct) };
    case 'por_grupo':
      return {
        type: 'por_grupo',
        markupPct: normalizeMarkup(rule.markupPct),
        byCategory: Object.fromEntries(
          Object.entries(rule.byCategory).map(([category, pct]) => [
            category,
            normalizeMarkup(pct),
          ]),
        ),
      };
  }
}

// Lo que la regla necesita saber de un producto simple.
export interface PricedProduct {
  cost: string;
  categoryId: string;
  vatRate: string;
}

// Margen que corresponde a un producto según la regla, o null si la regla no calcula precios.
export function markupFor(rule: PriceRule, categoryId: string): string | null {
  switch (rule.type) {
    case 'fijo':
      return null;
    case 'porcentaje_costo':
      return rule.markupPct;
    case 'por_grupo':
      return rule.byCategory[categoryId] ?? rule.markupPct;
  }
}

// costo × (1 + margen/100) × (1 + IVA/100), redondeado al centavo. Null en una lista de precio fijo.
export function computePrice(rule: PriceRule, product: PricedProduct): string | null {
  const markup = markupFor(rule, product.categoryId);
  if (markup === null) return null;
  const cost = parseDecimal(product.cost, MONEY_SCALE, 'El costo');
  const hundred = 100n * pow10(RATE_SCALE);
  const markupFactor = hundred + parseDecimal(markup, RATE_SCALE);
  const vatFactor = hundred + parseDecimal(product.vatRate, RATE_SCALE);
  const price = divideRoundingHalfUp(cost * markupFactor * vatFactor, hundred * hundred);
  return formatDecimal(price < 0n ? 0n : price, MONEY_SCALE);
}

// Normaliza un precio cargado a mano o el de un combo ("1500" → "1500.00").
export function normalizePrice(value: string, what = 'El precio'): string {
  const scaled = parseDecimal(value, MONEY_SCALE, what);
  if (scaled <= 0n || scaled >= pow10(12 + MONEY_SCALE)) {
    throw new DomainError('PRECIO_INVALIDO', `${what} tiene que ser mayor que cero.`);
  }
  return formatDecimal(scaled, MONEY_SCALE);
}
