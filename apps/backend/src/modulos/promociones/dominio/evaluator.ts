// Evaluador de promociones (T-121; RF-050, D-33). Función pura: recibe las líneas del carrito y
// las promociones vigentes y decide qué promoción se aplica a cada línea y con qué descuento.
// Cada línea recibe como máximo una promoción. Los componentes de un combo no reciben
// promociones: el combo es una sola línea y su categoría no existe, así que solo lo alcanza una
// promoción por producto dirigida al propio combo.
import {
  divideRoundingHalfUp,
  formatDecimal,
  MONEY_SCALE,
  parseDecimal,
  pow10,
  QUANTITY_SCALE,
  RATE_SCALE,
} from '../../../compartido/dominio/decimal.js';
import type { Promotion } from './promotions.js';

export interface CartLine {
  id: string;
  productId: string;
  // Nulo en un combo.
  categoryId: string | null;
  quantity: string;
  unitPrice: string;
}

export interface AppliedPromotion {
  lineId: string;
  promotionId: string;
  // Descuento total de la línea, con dos decimales.
  discount: string;
}

type Cents = bigint;

interface Outcome {
  promotion: Promotion;
  total: Cents;
  // Líneas que participan (aunque su descuento sea cero, como la unidad que se paga en un 2x1).
  lines: Map<string, Cents>;
}

const price = (line: CartLine): Cents => parseDecimal(line.unitPrice, MONEY_SCALE);
const quantity = (line: CartLine): bigint => parseDecimal(line.quantity, QUANTITY_SCALE);
// Unidades enteras de la línea: un NxM o un precio por cantidad cuentan unidades completas.
const wholeUnits = (line: CartLine): number => Number(quantity(line) / pow10(QUANTITY_SCALE));
const gross = (line: CartLine): Cents =>
  divideRoundingHalfUp(quantity(line) * price(line), pow10(QUANTITY_SCALE));

function eligible(promotion: Promotion, line: CartLine): boolean {
  return promotion.scope === 'producto'
    ? line.productId === promotion.targetId
    : line.categoryId !== null && line.categoryId === promotion.targetId;
}

// Descuento que daría una promoción sola sobre las líneas indicadas.
function evaluate(promotion: Promotion, lines: readonly CartLine[]): Outcome {
  const result = new Map<string, Cents>();
  const rule = promotion.rule;
  if (rule.type === 'porcentaje') {
    const percent = parseDecimal(rule.percent, RATE_SCALE);
    for (const line of lines) {
      result.set(line.id, divideRoundingHalfUp(gross(line) * percent, 100n * pow10(RATE_SCALE)));
    }
  } else if (rule.type === 'precio_cantidad') {
    // N unidades por un precio: cada grupo completo ahorra la diferencia con el precio de lista.
    for (const line of lines) {
      const groups = BigInt(Math.floor(wholeUnits(line) / rule.quantity));
      const saving = BigInt(rule.quantity) * price(line) - parseDecimal(rule.price, MONEY_SCALE);
      result.set(line.id, saving > 0n ? groups * saving : 0n);
    }
  } else {
    // NxM: se juntan las unidades de todas las líneas alcanzadas (en una categoría se mezclan
    // productos), se arman grupos de N desde la más cara y en cada grupo se bonifican sus N−M
    // unidades más baratas (D-69). Es lo que más ahorra: con un 2x1 sobre 4, 3, 2 y 1 se arman
    // [4, 3] y [2, 1] y se bonifican 3 y 1. Las unidades más baratas que sobran quedan libres.
    const pool = lines
      .flatMap((line) => Array.from({ length: wholeUnits(line) }, () => line))
      .sort((a, b) =>
        price(a) > price(b) ? -1 : price(a) < price(b) ? 1 : a.id.localeCompare(b.id),
      );
    const groups = Math.floor(pool.length / rule.take);
    pool.slice(0, groups * rule.take).forEach((unit, i) => {
      const isFree = i % rule.take >= rule.pay;
      result.set(unit.id, (result.get(unit.id) ?? 0n) + (isFree ? price(unit) : 0n));
    });
  }
  return {
    promotion,
    total: [...result.values()].reduce((a, b) => a + b, 0n),
    lines: result,
  };
}

// Elige las promociones del carrito. En cada paso se aplica la promoción que más ahorra entre las
// líneas que todavía no tienen una; sus líneas quedan fijadas y se sigue con las demás. A igual
// ahorro gana la que se creó primero (el orden de la lista). El descuento de una línea nunca
// supera su importe.
export function choosePromotions(
  lines: readonly CartLine[],
  promotions: readonly Promotion[],
): AppliedPromotion[] {
  const applied: AppliedPromotion[] = [];
  const pending = new Map(lines.map((l) => [l.id, l]));
  for (;;) {
    let best: Outcome | undefined;
    for (const promotion of promotions) {
      const candidates = [...pending.values()].filter((l) => eligible(promotion, l));
      if (candidates.length === 0) continue;
      const outcome = evaluate(promotion, candidates);
      if (outcome.total > 0n && (best === undefined || outcome.total > best.total)) best = outcome;
    }
    if (!best) break;
    for (const [lineId, discount] of best.lines) {
      const line = pending.get(lineId);
      if (!line) continue;
      const capped = discount > gross(line) ? gross(line) : discount;
      applied.push({
        lineId,
        promotionId: best.promotion.id,
        discount: formatDecimal(capped, MONEY_SCALE),
      });
      pending.delete(lineId);
    }
  }
  return applied.sort(
    (a, b) => lines.findIndex((l) => l.id === a.lineId) - lines.findIndex((l) => l.id === b.lineId),
  );
}
