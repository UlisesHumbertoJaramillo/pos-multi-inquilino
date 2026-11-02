import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../compartido/dominio/errors.js';
import {
  detectImageType,
  normalizeBarcode,
  normalizeCost,
  normalizeVatRate,
  type Product,
} from './catalog.js';
import { assertComponents, comboAvailability, comboSellable } from './combos.js';
import { computePrice, normalizeMarkup, normalizeRule, type PriceRule } from './price-rules.js';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return null;
};

describe('[RF-028] [RF-120] reglas de lista: tabla de casos esperados', () => {
  const COST_40: PriceRule = { type: 'porcentaje_costo', markupPct: '40' };
  const GROUP: PriceRule = {
    type: 'por_grupo',
    markupPct: '20',
    byCategory: { bebidas: '35' },
  };

  // precio = costo × (1 + margen) × (1 + IVA), redondeado al centavo (la mitad hacia arriba).
  it.each([
    { rule: COST_40, cost: '100.00', vat: '21', category: 'x', expected: '169.40' },
    { rule: COST_40, cost: '100.00', vat: '10.5', category: 'x', expected: '154.70' },
    { rule: COST_40, cost: '100.00', vat: '0', category: 'x', expected: '140.00' },
    { rule: COST_40, cost: '0.00', vat: '21', category: 'x', expected: '0.00' },
    {
      rule: { type: 'porcentaje_costo', markupPct: '25' },
      cost: '33.33',
      vat: '21',
      category: 'x',
      expected: '50.41',
    },
    {
      rule: { type: 'porcentaje_costo', markupPct: '30' },
      cost: '12.50',
      vat: '21',
      category: 'x',
      expected: '19.66',
    },
    {
      rule: { type: 'porcentaje_costo', markupPct: '0' },
      cost: '0.05',
      vat: '10',
      category: 'x',
      expected: '0.06',
    },
    {
      rule: { type: 'porcentaje_costo', markupPct: '-10' },
      cost: '200.00',
      vat: '21',
      category: 'x',
      expected: '217.80',
    },
    {
      rule: { type: 'porcentaje_costo', markupPct: '12.5' },
      cost: '80.00',
      vat: '21',
      category: 'x',
      expected: '108.90',
    },
    {
      rule: { type: 'porcentaje_costo', markupPct: '50' },
      cost: '999.99',
      vat: '27',
      category: 'x',
      expected: '1904.98',
    },
    { rule: GROUP, cost: '100.00', vat: '21', category: 'bebidas', expected: '163.35' },
    { rule: GROUP, cost: '100.00', vat: '0', category: 'libros', expected: '120.00' },
    { rule: { type: 'fijo' }, cost: '100.00', vat: '21', category: 'x', expected: null },
  ] satisfies {
    rule: PriceRule;
    cost: string;
    vat: string;
    category: string;
    expected: string | null;
  }[])(
    '$rule.type con costo $cost, IVA $vat% y categoría $category → $expected',
    ({ rule, cost, vat, category, expected }) => {
      const normalized = normalizeRule(rule);
      expect(
        computePrice(normalized, { cost, vatRate: normalizeVatRate(vat), categoryId: category }),
      ).toBe(expected);
    },
  );

  it('el margen se normaliza y se limita', () => {
    expect(normalizeMarkup('40')).toBe('40.0000');
    expect(code(() => normalizeMarkup('1001'))).toBe('MARGEN_FUERA_DE_RANGO');
    expect(code(() => normalizeMarkup('-91'))).toBe('MARGEN_FUERA_DE_RANGO');
    expect(code(() => normalizeMarkup('1.23456'))).toBe('NUMERO_INVALIDO');
  });
});

describe('[RF-029] [RF-131] [RF-159] datos del catálogo', () => {
  it('la tasa de IVA va de 0 a 100', () => {
    expect(normalizeVatRate('21')).toBe('21.0000');
    expect(normalizeVatRate('10.5')).toBe('10.5000');
    expect(code(() => normalizeVatRate('101'))).toBe('TASA_IVA_INVALIDA');
    expect(code(() => normalizeVatRate('-1'))).toBe('TASA_IVA_INVALIDA');
  });

  it('el costo no es negativo y el código de barras vacío equivale a no tenerlo', () => {
    expect(normalizeCost('1500')).toBe('1500.00');
    expect(code(() => normalizeCost('-1'))).toBe('COSTO_INVALIDO');
    expect(normalizeBarcode('  ')).toBeNull();
    expect(normalizeBarcode(' 7790001 ')).toBe('7790001');
    expect(code(() => normalizeBarcode('77 90'))).toBe('CODIGO_BARRAS_INVALIDO');
  });

  it('el tipo de imagen se toma del contenido', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
    expect(detectImageType(png)).toBe('image/png');
    expect(detectImageType(jpeg)).toBe('image/jpeg');
    expect(detectImageType(webp)).toBe('image/webp');
    expect(code(() => detectImageType(new TextEncoder().encode('<svg/>')))).toBe('IMAGEN_INVALIDA');
    expect(code(() => detectImageType(new Uint8Array(1024 * 1024 + 1)))).toBe('IMAGEN_INVALIDA');
  });
});

describe('[RF-052] stock de un combo: tabla de casos esperados', () => {
  it.each([
    {
      components: [
        { required: '1', available: '10' },
        { required: '2', available: '7' },
      ],
      expected: 3,
    },
    { components: [{ required: '0.5', available: '2.25' }], expected: 4 },
    { components: [{ required: '3', available: '2' }], expected: 0 },
    {
      components: [
        { required: '1', available: '0' },
        { required: '1', available: '50' },
      ],
      expected: 0,
    },
    {
      components: [
        { required: '2', available: '100' },
        { required: '1.5', available: '9' },
        { required: '4', available: '20' },
      ],
      expected: 5,
    },
    { components: [], expected: 0 },
  ])('$components → $expected', ({ components, expected }) => {
    expect(comboAvailability(components)).toBe(expected);
  });
});

describe('[RF-049] [RF-149] componentes de un combo', () => {
  const product = (id: string, overrides: Partial<Product> = {}): Product => ({
    id,
    tenantId: 't',
    type: 'simple',
    name: id,
    barcode: null,
    categoryId: 'c',
    cost: '1.00',
    comboPrice: null,
    isActive: true,
    hasImage: false,
    ...overrides,
  });
  const products = new Map([
    ['cafe', product('cafe')],
    ['medialuna', product('medialuna')],
    [
      'desayuno',
      product('desayuno', { type: 'combo', categoryId: null, cost: null, comboPrice: '10.00' }),
    ],
    ['viejo', product('viejo', { isActive: false })],
  ]);

  it('normaliza las cantidades de componentes válidos', () => {
    expect(
      assertComponents(
        [
          { productId: 'cafe', quantity: '1' },
          { productId: 'medialuna', quantity: '2' },
        ],
        products,
      ),
    ).toStrictEqual([
      { productId: 'cafe', quantity: '1.000' },
      { productId: 'medialuna', quantity: '2.000' },
    ]);
  });

  it('un combo no puede ser componente, ni repetirse un producto, ni usar uno dado de baja', () => {
    expect(code(() => assertComponents([{ productId: 'desayuno', quantity: '1' }], products))).toBe(
      'COMBO_COMO_COMPONENTE',
    );
    expect(
      code(() =>
        assertComponents(
          [
            { productId: 'cafe', quantity: '1' },
            { productId: 'cafe', quantity: '1' },
          ],
          products,
        ),
      ),
    ).toBe('COMPONENTES_INVALIDOS');
    expect(code(() => assertComponents([{ productId: 'viejo', quantity: '1' }], products))).toBe(
      'COMPONENTES_INVALIDOS',
    );
    expect(code(() => assertComponents([{ productId: 'cafe', quantity: '0' }], products))).toBe(
      'CANTIDAD_INVALIDA',
    );
    expect(code(() => assertComponents([], products))).toBe('COMPONENTES_INVALIDOS');
  });

  it('un combo con un componente dado de baja no se puede vender', () => {
    const combo = products.get('desayuno');
    if (!combo) throw new Error('falta el combo');
    expect(comboSellable(combo, [true, true])).toBe(true);
    expect(comboSellable(combo, [true, false])).toBe(false);
    expect(comboSellable({ ...combo, isActive: false }, [true, true])).toBe(false);
  });
});
