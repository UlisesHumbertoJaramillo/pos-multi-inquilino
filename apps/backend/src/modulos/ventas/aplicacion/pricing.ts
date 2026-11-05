// Totales del carrito en cada cambio (T-153, T-154; RF-030, RF-031, RF-050, RF-060, RF-121,
// RF-143). El precio de cada ítem quedó fijado al agregarlo; la promoción se elige con el
// evaluador entre las vigentes en la sucursal y las ya fijadas en el carrito, aunque hayan vencido
// (D-84). El motor calcula descuentos, total e IVA.
import {
  computeSale,
  discountPercent,
  formatTotals,
  money,
  type SaleLineInput,
  vatBreakdown,
} from '../../calculo/aplicacion/engine.js';
import {
  choosePromotions,
  isApplicable,
  type Promotion,
} from '../../promociones/aplicacion/promotions.js';
import type { ManualDiscountInput } from '../dominio/sales.js';
import type { SaleItem } from './ports.js';

export interface VatLine {
  rate: string;
  taxed: string;
  net: string;
  vat: string;
}

export interface PricedCart {
  items: SaleItem[];
  subtotal: string;
  promoDiscount: string;
  manualDiscount: string;
  total: string;
  // Porcentaje que representa el descuento manual, para controlarlo contra la cuota.
  manualPercent: string;
  vat: VatLine[];
  promotionNames: Map<string, string>;
}

export function priceCart(
  items: readonly SaleItem[],
  discount: ManualDiscountInput | null,
  promotions: readonly Promotion[],
  branchId: string,
  at: Date,
): PricedCart {
  const fixed = new Set(items.map((i) => i.promotionId).filter((id) => id !== null));
  const candidates = promotions.filter((p) => fixed.has(p.id) || isApplicable(p, at, branchId));
  const applied = new Map(
    choosePromotions(
      items.map((i) => ({
        id: i.id,
        productId: i.productId,
        // Un combo no recibe promociones de categoría (RF-050).
        categoryId: i.type === 'combo' ? null : i.categoryId,
        quantity: i.quantity,
        unitPrice: i.fixedPrice,
      })),
      candidates,
    ).map((a) => [a.lineId, a]),
  );
  const inputs: SaleLineInput[] = items.map((i) => ({
    id: i.id,
    quantity: i.quantity,
    unitPrice: i.fixedPrice,
    vatRate: i.vatRate,
    promoDiscount: applied.get(i.id)?.discount ?? '0.00',
    ...(i.type === 'combo'
      ? {
          comboParts: i.components.map((c) => ({
            productId: c.productId,
            vatRate: c.vatRate,
            listPrice: c.listPrice,
            quantity: c.quantity,
          })),
        }
      : {}),
  }));
  const totals = computeSale(inputs, discount);
  const formatted = formatTotals(totals);
  const vat = items.length === 0 ? [] : vatBreakdown(inputs, totals).byRate;
  return {
    items: items.map((item) => {
      const line = formatted.lines.find((l) => l.id === item.id);
      return {
        ...item,
        promotionId: applied.get(item.id)?.promotionId ?? null,
        promoDiscount: line?.promoDiscount ?? '0.00',
        manualDiscount: line?.manualDiscount ?? '0.00',
        final: line?.final ?? '0.00',
      };
    }),
    subtotal: formatted.subtotal,
    promoDiscount: formatted.promoDiscount,
    manualDiscount: formatted.manualDiscount,
    total: formatted.total,
    manualPercent: discountPercent(totals.subtotal, totals.manualDiscount),
    vat: vat.map((v) => ({
      rate: v.rate,
      taxed: money(v.taxed),
      net: money(v.net),
      vat: money(v.vat),
    })),
    promotionNames: new Map(candidates.map((p) => [p.id, p.name])),
  };
}
