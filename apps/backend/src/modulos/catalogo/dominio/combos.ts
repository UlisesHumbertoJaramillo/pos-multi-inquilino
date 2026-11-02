// Combos: componentes, disponibilidad y stock derivado (T-080 a T-082; RF-049, RF-052, RF-149).
// Un combo no tiene stock propio: su disponibilidad sale de sus componentes (S-3).
import {
  divideFloor,
  formatDecimal,
  parseDecimal,
  pow10,
  QUANTITY_SCALE,
} from '../../../compartido/dominio/decimal.js';
import { DomainError } from '../../../compartido/dominio/errors.js';
import type { Product } from './catalog.js';

export interface ComboComponent {
  productId: string;
  // Cantidad con 3 decimales: "2.000".
  quantity: string;
}

export const MAX_COMBO_COMPONENTS = 20;

export function normalizeQuantity(value: string): string {
  const scaled = parseDecimal(value, QUANTITY_SCALE, 'La cantidad');
  if (scaled <= 0n || scaled >= pow10(9 + QUANTITY_SCALE)) {
    throw new DomainError('CANTIDAD_INVALIDA', 'La cantidad tiene que ser mayor que cero.');
  }
  return formatDecimal(scaled, QUANTITY_SCALE);
}

// Valida los componentes contra los productos encontrados (por id, del mismo comercio).
export function assertComponents(
  components: readonly ComboComponent[],
  products: ReadonlyMap<string, Product>,
): ComboComponent[] {
  if (components.length === 0 || components.length > MAX_COMBO_COMPONENTS) {
    throw new DomainError(
      'COMPONENTES_INVALIDOS',
      `Un combo tiene entre 1 y ${String(MAX_COMBO_COMPONENTS)} componentes.`,
    );
  }
  const seen = new Set<string>();
  return components.map((component) => {
    if (seen.has(component.productId)) {
      throw new DomainError('COMPONENTES_INVALIDOS', 'Un producto aparece dos veces en el combo.');
    }
    seen.add(component.productId);
    const product = products.get(component.productId);
    if (!product?.isActive) {
      throw new DomainError(
        'COMPONENTES_INVALIDOS',
        'Un componente no existe o está dado de baja.',
      );
    }
    if (product.type === 'combo') {
      throw new DomainError(
        'COMBO_COMO_COMPONENTE',
        `«${product.name}» es un combo y no puede ser componente de otro combo.`,
      );
    }
    return { productId: component.productId, quantity: normalizeQuantity(component.quantity) };
  });
}

// Un combo se puede vender si está activo y todos sus componentes también (RF-149).
export function comboSellable(combo: Product, componentsActive: readonly boolean[]): boolean {
  return combo.isActive && componentsActive.length > 0 && componentsActive.every(Boolean);
}

// Unidades disponibles de un combo: el mínimo, entre sus componentes, del stock disponible
// dividido por la cantidad que requiere, redondeado hacia abajo (RF-052).
export function comboAvailability(
  components: readonly { required: string; available: string }[],
): number {
  if (components.length === 0) return 0;
  const units = components.map(({ required, available }) => {
    const need = parseDecimal(required, QUANTITY_SCALE);
    const have = parseDecimal(available, QUANTITY_SCALE);
    return have <= 0n ? 0n : divideFloor(have, need);
  });
  return Number(units.reduce((min, value) => (value < min ? value : min)));
}
