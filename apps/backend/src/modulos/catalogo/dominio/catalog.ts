// Categorías, productos e imágenes del catálogo (T-073 a T-075; RF-029, RF-130, RF-131, RF-159).
import {
  formatDecimal,
  MONEY_SCALE,
  parseDecimal,
  pow10,
  RATE_SCALE,
} from '../../../compartido/dominio/decimal.js';
import { DomainError } from '../../../compartido/dominio/errors.js';

export interface Category {
  id: string;
  tenantId: string;
  name: string;
  // Porcentaje con 4 decimales: "21.0000".
  vatRate: string;
  isActive: boolean;
}

export type ProductType = 'simple' | 'combo';

export interface Product {
  id: string;
  tenantId: string;
  type: ProductType;
  name: string;
  barcode: string | null;
  // Solo los productos simples: categoría y costo sin IVA.
  categoryId: string | null;
  cost: string | null;
  // Solo los combos: su precio único (RF-049).
  comboPrice: string | null;
  isActive: boolean;
  hasImage: boolean;
}

export function assertCatalogName(value: string, max: number, what: string): string {
  const name = value.trim();
  if (name.length === 0 || name.length > max) {
    throw new DomainError(
      'NOMBRE_INVALIDO',
      `${what} es obligatorio y tiene hasta ${String(max)} caracteres.`,
    );
  }
  return name;
}

// "21" → "21.0000". Entre 0 y 100.
export function normalizeVatRate(value: string): string {
  const scaled = parseDecimal(value, RATE_SCALE, 'La tasa de IVA');
  if (scaled < 0n || scaled > 100n * pow10(RATE_SCALE)) {
    throw new DomainError('TASA_IVA_INVALIDA', 'La tasa de IVA tiene que estar entre 0% y 100%.');
  }
  return formatDecimal(scaled, RATE_SCALE);
}

// "1500" → "1500.00". No negativo.
export function normalizeCost(value: string): string {
  const scaled = parseDecimal(value, MONEY_SCALE, 'El costo');
  if (scaled < 0n || scaled >= pow10(12 + MONEY_SCALE)) {
    throw new DomainError('COSTO_INVALIDO', 'El costo no puede ser negativo.');
  }
  return formatDecimal(scaled, MONEY_SCALE);
}

const BARCODE_PATTERN = /^[0-9A-Za-z-]{1,48}$/;

// Código de barras opcional: vacío equivale a no tenerlo.
export function normalizeBarcode(value: string | null): string | null {
  const barcode = value?.trim() ?? '';
  if (barcode === '') return null;
  if (!BARCODE_PATTERN.test(barcode)) {
    throw new DomainError(
      'CODIGO_BARRAS_INVALIDO',
      'El código de barras admite letras, números y guiones, hasta 48 caracteres.',
    );
  }
  return barcode;
}

export function barcodeTaken(): DomainError {
  return new DomainError(
    'CODIGO_BARRAS_EN_USO',
    'Ese código de barras ya lo usa otro producto activo del comercio.',
  );
}

// Imagen de producto (RF-159). El tipo se toma del contenido, no de lo que declara el cliente.
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export const MAX_IMAGE_BYTES = 1024 * 1024;

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte);

export function detectImageType(bytes: Uint8Array): ImageType {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new DomainError('IMAGEN_INVALIDA', 'La imagen tiene que pesar hasta 1 MB.');
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  throw new DomainError('IMAGEN_INVALIDA', 'La imagen tiene que ser PNG, JPEG o WebP.');
}
