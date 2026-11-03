// Pruebas por propiedades del motor de cálculo (T-119; RF-121 a RF-123). Cada caso se genera con
// una semilla fija: si alguno falla, el mensaje indica el número de caso para reproducirlo.
import { describe, expect, it } from 'vitest';
import { formatDecimal, MONEY_SCALE, QUANTITY_SCALE } from '../../../compartido/dominio/decimal.js';
import { planPayment } from './payments.js';
import { refundByFraction, returnedLineValue } from './refunds.js';
import { allocate, type Cents, sum } from './rounding.js';
import { computeSale, type ManualDiscount, type SaleLineInput, vatBreakdown } from './sale.js';

const CASES = 1000;

// Generador pseudoaleatorio determinista (mulberry32).
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(values: readonly T[]): T => values[int(0, values.length - 1)] as T;
  return { int, pick };
}

const RATES = ['0', '10.5', '21', '27'];
const ADJUSTMENTS = ['0', '0', '10', '-5', '15', '-10', '3.5'];

function generateSale(seed: number) {
  const r = random(seed);
  const lines: SaleLineInput[] = Array.from({ length: r.int(1, 8) }, (_, i) => {
    const quantity = formatDecimal(BigInt(r.int(1, 20_000)), QUANTITY_SCALE);
    const unitPrice = formatDecimal(BigInt(r.int(1, 2_000_000)), MONEY_SCALE);
    const combo = r.int(0, 4) === 0;
    return {
      id: `l${String(i)}`,
      quantity,
      unitPrice,
      promoDiscount: '0',
      vatRate: combo ? null : r.pick(RATES),
      ...(combo
        ? {
            comboParts: Array.from({ length: r.int(2, 4) }, (_, j) => ({
              productId: `p${String(j)}`,
              vatRate: r.pick(RATES),
              listPrice: formatDecimal(BigInt(r.int(1, 500_000)), MONEY_SCALE),
              quantity: formatDecimal(BigInt(r.int(1_000, 5_000)), QUANTITY_SCALE),
            })),
          }
        : {}),
    };
  });
  // Una promoción de hasta la mitad del importe de cada ítem.
  const withPromo = lines.map((line) => {
    const gross = computeSale([line]).lines[0]?.gross ?? 0n;
    const promo = r.int(0, 2) === 0 ? BigInt(r.int(0, Number(gross / 2n))) : 0n;
    return { ...line, promoDiscount: formatDecimal(promo, MONEY_SCALE) };
  });
  const discountKind = r.int(0, 2);
  const subtotal = computeSale(withPromo).subtotal;
  const discount: ManualDiscount | null =
    discountKind === 0
      ? null
      : discountKind === 1
        ? { type: 'porcentaje', value: String(r.int(0, 100)) }
        : { type: 'monto', value: formatDecimal(BigInt(r.int(0, Number(subtotal))), MONEY_SCALE) };
  return { r, lines: withPromo, discount };
}

// Reparte el total en k fracciones al azar (cada una de al menos un centavo).
function split(r: ReturnType<typeof random>, total: Cents): Cents[] {
  const k = Math.min(r.int(1, 4), Number(total));
  const cuts = Array.from({ length: k - 1 }, () => BigInt(r.int(1, Number(total) - 1))).sort(
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const points = [0n, ...cuts, total];
  return points
    .slice(1)
    .map((p, i) => p - (points[i] ?? 0n))
    .filter((v) => v > 0n);
}

describe('[RF-121] [RF-122] [RF-123] propiedades del motor de cálculo', () => {
  it(`el prorrateo nunca deja diferencia ni partes negativas (${String(CASES)} casos)`, () => {
    for (let n = 0; n < CASES; n++) {
      const r = random(n);
      const total = BigInt(r.int(0, 10_000_000));
      const weights = Array.from({ length: r.int(1, 12) }, () => BigInt(r.int(0, 1_000_000)));
      const shares = allocate(total, weights);
      expect(sum(shares), `caso ${String(n)}`).toBe(total);
      expect(
        shares.every((s) => s >= 0n),
        `caso ${String(n)}`,
      ).toBe(true);
    }
  });

  it(`la venta, sus fracciones y su IVA suman siempre el total (${String(CASES)} casos)`, () => {
    for (let n = 0; n < CASES; n++) {
      const { r, lines, discount } = generateSale(n);
      const sale = computeSale(lines, discount);
      const label = `caso ${String(n)}`;
      expect(sum(sale.lines.map((l) => l.final)), label).toBe(sale.total);
      expect(sum(sale.lines.map((l) => l.manualDiscount)), label).toBe(sale.manualDiscount);
      expect(
        sale.lines.every((l) => l.final >= 0n),
        label,
      ).toBe(true);
      if (sale.total === 0n) continue;

      const amounts = split(r, sale.total);
      const plan = planPayment(
        sale.total,
        amounts.map((amount, i) => ({
          id: `f${String(i)}`,
          cash: i === 0,
          adjustmentPct: r.pick(ADJUSTMENTS),
          amount: formatDecimal(amount, MONEY_SCALE),
        })),
      );
      expect(sum(plan.fractions.map((f) => f.amount)), label).toBe(sale.total);
      expect(sum(plan.fractions.map((f) => f.charged)), label).toBe(plan.totalToCharge);
      expect(plan.totalToCharge, label).toBe(sale.total + plan.adjustment);

      // La base del IVA es exactamente lo cobrado, y neto + IVA es cada parte.
      const { parts, byRate } = vatBreakdown(lines, sale, plan.adjustment);
      expect(sum(parts.map((p) => p.taxed)), label).toBe(plan.totalToCharge);
      expect(
        parts.every((p) => p.net + p.vat === p.taxed),
        label,
      ).toBe(true);
      expect(sum(byRate.map((b) => b.taxed)), label).toBe(plan.totalToCharge);
    }
  });

  it(`devoluciones parciales sucesivas reintegran exactamente lo cobrado (${String(CASES)} casos)`, () => {
    for (let n = 0; n < CASES; n++) {
      const r = random(n);
      const label = `caso ${String(n)}`;
      // Una línea vendida en unidades enteras, devuelta en varias veces.
      const quantity = r.int(1, 12);
      const lineFinal = BigInt(r.int(1, 5_000_000));
      let returnedQty = 0;
      let returnedValue = 0n;
      const charged = split(r, lineFinal).map(
        // Cada fracción con un recargo o descuento de hasta el 10 %.
        (amount) => amount + (amount * BigInt(r.int(-10, 10))) / 100n,
      );
      const fractions = charged.map((c, i) => ({
        id: `f${String(i)}`,
        creditAccount: false,
        charged: c,
      }));
      const refunded = fractions.map(() => 0n);
      while (returnedQty < quantity) {
        const now = r.int(1, quantity - returnedQty);
        const value = returnedLineValue(
          lineFinal,
          String(quantity),
          String(returnedQty),
          String(now),
        );
        const step = refundByFraction(lineFinal, fractions, returnedValue, value);
        step.forEach((s, i) => {
          expect(s.refund >= 0n || (fractions[i]?.charged ?? 0n) < 0n, label).toBe(true);
          refunded[i] = (refunded[i] ?? 0n) + s.refund;
        });
        returnedQty += now;
        returnedValue += value;
      }
      expect(returnedValue, label).toBe(lineFinal);
      expect(refunded, label).toStrictEqual(charged);
    }
  });
});
