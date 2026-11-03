// Promociones: tipos, vigencia y elección de la mejor por ítem (T-120, T-121; RF-048, RF-050).
import { describe, expect, it } from 'vitest';
import { type CartLine, choosePromotions } from './evaluator.js';
import { isApplicable, normalizeRule, type Promotion, type PromotionRule } from './promotions.js';

const promo = (
  id: string,
  rule: PromotionRule,
  scope: 'producto' | 'categoria',
  targetId: string,
): Promotion => ({
  id,
  tenantId: 't',
  name: id,
  rule,
  scope,
  targetId,
  validFrom: new Date('2026-11-01T00:00:00Z'),
  validUntil: new Date('2026-12-01T00:00:00Z'),
  branchIds: null,
  isActive: true,
});

const line = (
  id: string,
  quantity: string,
  unitPrice: string,
  categoryId: string | null = 'bebidas',
  productId = id,
): CartLine => ({ id, productId, categoryId, quantity, unitPrice });

const DOS_POR_UNO_BEBIDAS = promo(
  '2x1-bebidas',
  { type: 'nxm', take: 2, pay: 1 },
  'categoria',
  'bebidas',
);
const DOS_POR_UNO_AGUA = promo('2x1-agua', { type: 'nxm', take: 2, pay: 1 }, 'producto', 'agua');

const result = (lines: CartLine[], promotions: Promotion[]) =>
  choosePromotions(lines, promotions).map((a) => [a.lineId, a.promotionId, a.discount]);

describe('[RF-050] evaluador de promociones', () => {
  it.each([
    ['3', [['agua', '2x1-agua', '100.00']]],
    ['4', [['agua', '2x1-agua', '200.00']]],
    ['1', []],
  ])('2x1 de un producto con %s unidades', (quantity, expected) => {
    expect(result([line('agua', quantity, '100')], [DOS_POR_UNO_AGUA])).toStrictEqual(expected);
  });

  it('2x1 de una categoría mezcla productos y bonifica el más barato', () => {
    expect(
      result([line('agua', '1', '100'), line('gaseosa', '1', '300')], [DOS_POR_UNO_BEBIDAS]),
    ).toStrictEqual([
      ['agua', '2x1-bebidas', '100.00'],
      ['gaseosa', '2x1-bebidas', '0.00'],
    ]);
  });

  it('los grupos se arman desde la unidad más cara: 300+300 y 100+100 bonifican 400', () => {
    expect(
      result([line('agua', '2', '100'), line('gaseosa', '2', '300')], [DOS_POR_UNO_BEBIDAS]),
    ).toStrictEqual([
      ['agua', '2x1-bebidas', '100.00'],
      ['gaseosa', '2x1-bebidas', '300.00'],
    ]);
  });

  it('con promociones superpuestas, cada ítem recibe una sola: la que más ahorra', () => {
    const treintaGaseosa = promo(
      '30-gaseosa',
      { type: 'porcentaje', percent: '30' },
      'producto',
      'gaseosa',
    );
    // 2x1 sobre 2 gaseosas (300) ahorra más que el 30 % (180).
    expect(
      result([line('gaseosa', '2', '300')], [treintaGaseosa, DOS_POR_UNO_BEBIDAS]),
    ).toStrictEqual([['gaseosa', '2x1-bebidas', '300.00']]);
  });

  it('la unidad que sobra del 2x1 queda libre para otra promoción', () => {
    const mitadAgua = promo('50-agua', { type: 'porcentaje', percent: '50' }, 'producto', 'agua');
    // Gaseosa 300 + 300 forman el grupo; el agua no entra y recibe su 50 %.
    expect(
      result(
        [line('agua', '1', '100'), line('gaseosa', '2', '300')],
        [DOS_POR_UNO_BEBIDAS, mitadAgua],
      ),
    ).toStrictEqual([
      ['agua', '50-agua', '50.00'],
      ['gaseosa', '2x1-bebidas', '300.00'],
    ]);
  });

  it.each([
    ['1000', '7', '400.00'],
    ['1300', '7', null],
    ['1000', '2', null],
  ])('3 por %s con %s yogures de 400 → %s', (price, quantity, discount) => {
    const tres = promo('3x', { type: 'precio_cantidad', quantity: 3, price }, 'producto', 'yogur');
    const applied = result([line('yogur', quantity, '400', 'lacteos')], [tres]);
    expect(applied).toStrictEqual(discount === null ? [] : [['yogur', '3x', discount]]);
  });

  it('un combo no recibe promociones de categoría, pero sí una dirigida al combo', () => {
    const combo = line('combo', '1', '3500', null);
    const diezCombo = promo('10-combo', { type: 'porcentaje', percent: '10' }, 'producto', 'combo');
    expect(result([combo], [DOS_POR_UNO_BEBIDAS])).toStrictEqual([]);
    expect(result([combo], [diezCombo])).toStrictEqual([['combo', '10-combo', '350.00']]);
  });

  it('el porcentaje acepta cantidades con decimales; el NxM cuenta unidades enteras', () => {
    const diez = promo('10-queso', { type: 'porcentaje', percent: '10' }, 'producto', 'queso');
    const dosPorUno = promo('2x1-queso', { type: 'nxm', take: 2, pay: 1 }, 'producto', 'queso');
    expect(result([line('queso', '0.500', '1000', 'lacteos')], [diez])).toStrictEqual([
      ['queso', '10-queso', '50.00'],
    ]);
    expect(result([line('queso', '1.500', '1000', 'lacteos')], [dosPorUno])).toStrictEqual([]);
  });

  it('a igual ahorro gana la que está primero en la lista', () => {
    const otra = promo('otra-agua', { type: 'porcentaje', percent: '50' }, 'producto', 'agua');
    expect(result([line('agua', '2', '100')], [DOS_POR_UNO_AGUA, otra])).toStrictEqual([
      ['agua', '2x1-agua', '100.00'],
    ]);
  });
});

describe('[RF-048] tipos y vigencia de las promociones', () => {
  it.each([
    [{ type: 'nxm', take: 2, pay: 2 }, 'producto'],
    [{ type: 'nxm', take: 0, pay: 0 }, 'producto'],
    [{ type: 'porcentaje', percent: '0' }, 'producto'],
    [{ type: 'porcentaje', percent: '100.01' }, 'categoria'],
    [{ type: 'precio_cantidad', quantity: 3, price: '1000' }, 'categoria'],
    [{ type: 'precio_cantidad', quantity: 1, price: '1000' }, 'producto'],
  ] as [PromotionRule, 'producto' | 'categoria'][])('rechaza %j en %s', (rule, scope) => {
    expect(() => normalizeRule(rule, scope)).toThrow(
      expect.objectContaining({ code: 'PROMOCION_INVALIDA' }),
    );
  });

  it('normaliza los parámetros', () => {
    expect(normalizeRule({ type: 'porcentaje', percent: '15' }, 'categoria')).toStrictEqual({
      type: 'porcentaje',
      percent: '15.0000',
    });
  });

  it.each([
    ['2026-10-31T23:59:59Z', null, false],
    ['2026-11-01T00:00:00Z', null, true],
    ['2026-12-01T00:00:00Z', null, false],
    ['2026-11-15T00:00:00Z', 'norte', false],
    ['2026-11-15T00:00:00Z', 'centro', true],
  ])('en %s, sucursal %s → %s', (at, branch, expected) => {
    const onlyCentro = { ...DOS_POR_UNO_AGUA, branchIds: ['centro'] };
    const target = branch === null ? DOS_POR_UNO_AGUA : onlyCentro;
    expect(isApplicable(target, new Date(at), branch)).toBe(expected);
  });
});
