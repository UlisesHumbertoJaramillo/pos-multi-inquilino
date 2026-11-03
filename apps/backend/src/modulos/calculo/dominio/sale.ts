// Total de la venta e IVA incluido (T-113, T-114, T-117; RF-120, RF-121, RF-124, D-16 a D-18).
// Orden de D-17: precio fijado por ítem → promoción automática → descuento manual prorrateado.
// Los precios de lista son finales con IVA incluido; el IVA se desglosa hacia atrás.
import {
  divideRoundingHalfUp,
  formatDecimal,
  parseDecimal,
  pow10,
  RATE_SCALE,
} from '../../../compartido/dominio/decimal.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import { allocate, cents, type Cents, lineAmount, money, percentOf, sum } from './rounding.js';

// Parte de un combo para el IVA: su peso es el precio de lista del componente por la cantidad que
// lleva el combo (D-18).
export interface ComboPart {
  productId: string;
  vatRate: string;
  listPrice: string;
  quantity: string;
}

export interface SaleLineInput {
  id: string;
  quantity: string;
  // Precio unitario fijado al agregar el ítem (RF-030), final con IVA.
  unitPrice: string;
  // Tasa de IVA de la categoría. En un combo se ignora: cada parte lleva la suya.
  vatRate: string | null;
  // Descuento total de la promoción aplicada a la línea (lo calcula el evaluador).
  promoDiscount: string;
  comboParts?: readonly ComboPart[];
}

export type ManualDiscount =
  { type: 'porcentaje'; value: string } | { type: 'monto'; value: string };

export interface SaleLineResult {
  id: string;
  gross: Cents;
  promoDiscount: Cents;
  manualDiscount: Cents;
  // Importe final de la línea: lo que paga el cliente por ella antes de los medios de pago.
  final: Cents;
}

export interface SaleTotals {
  lines: SaleLineResult[];
  // Suma después de promociones, sobre la que se calcula el descuento manual.
  subtotal: Cents;
  promoDiscount: Cents;
  manualDiscount: Cents;
  total: Cents;
}

export function manualDiscountAmount(subtotal: Cents, discount: ManualDiscount | null): Cents {
  if (discount === null) return 0n;
  const amount =
    discount.type === 'porcentaje'
      ? percentOf(subtotal, discount.value)
      : cents(discount.value, 'El descuento');
  if (amount < 0n) {
    throw new DomainError('DESCUENTO_INVALIDO', 'El descuento no puede ser negativo.');
  }
  if (amount > subtotal) {
    throw new DomainError(
      'DESCUENTO_INVALIDO',
      'El descuento no puede superar el total de la venta.',
    );
  }
  return amount;
}

// Porcentaje que representa un descuento sobre el subtotal, con 4 decimales, para controlarlo
// contra el porcentaje máximo de la cuota (RF-065).
export function discountPercent(subtotal: Cents, discount: Cents): string {
  if (subtotal === 0n) return formatDecimal(0n, RATE_SCALE);
  return formatDecimal(
    divideRoundingHalfUp(discount * 100n * pow10(RATE_SCALE), subtotal),
    RATE_SCALE,
  );
}

export function computeSale(
  lines: readonly SaleLineInput[],
  discount: ManualDiscount | null = null,
): SaleTotals {
  const afterPromo = lines.map((line) => {
    const gross = lineAmount(line.quantity, line.unitPrice);
    const promo = cents(line.promoDiscount, 'El descuento de la promoción');
    if (gross < 0n || promo < 0n || promo > gross) {
      throw new DomainError(
        'LINEA_INVALIDA',
        'El descuento de una promoción no puede superar el ítem.',
      );
    }
    return { id: line.id, gross, promo, net: gross - promo };
  });
  const subtotal = sum(afterPromo.map((l) => l.net));
  const manual = manualDiscountAmount(subtotal, discount);
  // El descuento manual afecta a toda la venta: se prorratea según el importe de cada ítem.
  const shares = allocate(
    manual,
    afterPromo.map((l) => l.net),
  );
  const results = afterPromo.map((l, i) => {
    const share = shares[i] ?? 0n;
    return {
      id: l.id,
      gross: l.gross,
      promoDiscount: l.promo,
      manualDiscount: share,
      final: l.net - share,
    };
  });
  return {
    lines: results,
    subtotal,
    promoDiscount: sum(results.map((l) => l.promoDiscount)),
    manualDiscount: manual,
    total: sum(results.map((l) => l.final)),
  };
}

export interface VatPart {
  lineId: string;
  productId: string | null;
  vatRate: string;
  // Base imponible con IVA incluido (importe final más su parte de recargos y descuentos de pago).
  taxed: Cents;
  net: Cents;
  vat: Cents;
}

export interface VatSummary {
  rate: string;
  taxed: Cents;
  net: Cents;
  vat: Cents;
}

// IVA hacia atrás de un importe con IVA incluido (RF-120): neto = importe / (1 + tasa), redondeado
// al centavo; el IVA es la diferencia, así neto + IVA es siempre el importe.
export function vatIncluded(taxed: Cents, rate: string): { net: Cents; vat: Cents } {
  const r = parseDecimal(rate, RATE_SCALE, 'La tasa de IVA');
  const scale = 100n * pow10(RATE_SCALE);
  const net = divideRoundingHalfUp(taxed * scale, scale + r);
  return { net, vat: taxed - net };
}

// Desglose del IVA de la venta (RF-120, RF-122, RF-124). Los recargos y descuentos de los medios
// de pago integran la base del IVA: se prorratean entre las líneas según su importe final. Un
// combo se prorratea entre sus componentes según el precio de lista de cada uno, y cada parte
// lleva la tasa de su categoría (D-18).
export function vatBreakdown(
  inputs: readonly SaleLineInput[],
  totals: SaleTotals,
  paymentAdjustment: Cents = 0n,
): { parts: VatPart[]; byRate: VatSummary[] } {
  const adjustments = allocate(
    paymentAdjustment,
    totals.lines.map((l) => l.final),
  );
  const parts: VatPart[] = [];
  totals.lines.forEach((line, i) => {
    const input = inputs.find((l) => l.id === line.id);
    if (!input) throw new Error(`Falta la línea ${line.id}.`);
    const taxed = line.final + (adjustments[i] ?? 0n);
    for (const part of splitCombo(input, taxed)) {
      parts.push({ lineId: line.id, ...part, ...vatIncluded(part.taxed, part.vatRate) });
    }
  });
  const rates = new Map<string, VatSummary>();
  for (const part of parts) {
    const key = formatDecimal(parseDecimal(part.vatRate, RATE_SCALE), RATE_SCALE);
    const current = rates.get(key) ?? { rate: key, taxed: 0n, net: 0n, vat: 0n };
    rates.set(key, {
      rate: key,
      taxed: current.taxed + part.taxed,
      net: current.net + part.net,
      vat: current.vat + part.vat,
    });
  }
  return {
    parts,
    byRate: [...rates.values()].sort((a, b) =>
      Number(parseDecimal(b.rate, RATE_SCALE) - parseDecimal(a.rate, RATE_SCALE)),
    ),
  };
}

// Importe de una línea repartido para el IVA: entero si es simple, por componente si es combo.
export function splitCombo(
  line: SaleLineInput,
  taxed: Cents,
): { productId: string | null; vatRate: string; taxed: Cents }[] {
  const parts = line.comboParts ?? [];
  if (parts.length === 0) {
    if (line.vatRate === null) {
      throw new DomainError(
        'LINEA_INVALIDA',
        'Una línea sin combo tiene que tener su tasa de IVA.',
      );
    }
    return [{ productId: null, vatRate: line.vatRate, taxed }];
  }
  const shares = allocate(
    taxed,
    parts.map((p) => lineAmount(p.quantity, p.listPrice)),
  );
  return parts.map((p, i) => ({
    productId: p.productId,
    vatRate: p.vatRate,
    taxed: shares[i] ?? 0n,
  }));
}

// Para mostrar o guardar: los montos como texto con dos decimales.
export function formatTotals(totals: SaleTotals) {
  return {
    lines: totals.lines.map((l) => ({
      id: l.id,
      gross: money(l.gross),
      promoDiscount: money(l.promoDiscount),
      manualDiscount: money(l.manualDiscount),
      final: money(l.final),
    })),
    subtotal: money(totals.subtotal),
    promoDiscount: money(totals.promoDiscount),
    manualDiscount: money(totals.manualDiscount),
    total: money(totals.total),
  };
}
