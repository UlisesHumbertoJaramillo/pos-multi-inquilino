// Tablas de casos del motor de cálculo, calculadas a mano (T-112 a T-118; Const. 7, plan §5.1).
import { describe, expect, it } from 'vitest';
import { planPayment } from './payments.js';
import { creditRefund, refundByFraction, returnedLineValue } from './refunds.js';
import { allocate, cents, money } from './rounding.js';
import { computeSale, type SaleLineInput, splitCombo, vatBreakdown, vatIncluded } from './sale.js';

const m = (values: bigint[]) => values.map(money);

describe('[RF-123] redondeo y prorrateo con la diferencia en la última línea', () => {
  it.each([
    ['10.00', ['1', '1', '1'], ['3.33', '3.34', '3.33']],
    ['0.03', ['100', '100', '1'], ['0.01', '0.02', '0.00']],
    ['1.00', ['0', '0'], ['0.00', '1.00']],
    ['100.00', ['1', '3'], ['25.00', '75.00']],
    ['0.05', ['1', '1'], ['0.03', '0.02']],
  ])('%s entre %j → %j', (total, weights, expected) => {
    const shares = allocate(
      cents(total),
      weights.map((w) => BigInt(w)),
    );
    expect(m(shares)).toStrictEqual(expected);
    expect(money(shares.reduce((a, b) => a + b, 0n))).toBe(total);
  });
});

describe('[RF-120] IVA incluido desglosado hacia atrás', () => {
  it.each([
    ['121.00', '21', '100.00', '21.00'],
    ['110.50', '10.5', '100.00', '10.50'],
    ['50.00', '0', '50.00', '0.00'],
    ['169.40', '21', '140.00', '29.40'],
    ['10.00', '21', '8.26', '1.74'],
    ['10.00', '10.5', '9.05', '0.95'],
    ['0.01', '21', '0.01', '0.00'],
  ])('%s con %s %% → neto %s, IVA %s', (taxed, rate, net, vat) => {
    const result = vatIncluded(cents(taxed), rate);
    expect([money(result.net), money(result.vat)]).toStrictEqual([net, vat]);
  });
});

const line = (
  id: string,
  quantity: string,
  unitPrice: string,
  promoDiscount = '0',
  vatRate = '21',
): SaleLineInput => ({ id, quantity, unitPrice, promoDiscount, vatRate });

describe('[RF-121] total: precio fijado → promoción → descuento manual prorrateado', () => {
  // A: 2 × 100 con un 2x1 (−100); B: 1 × 300. Subtotal 400.
  const lines = [line('a', '2', '100', '100'), line('b', '1', '300')];

  it.each([
    [null, ['100.00', '300.00'], '0.00', '400.00'],
    [{ type: 'porcentaje', value: '10' } as const, ['90.00', '270.00'], '40.00', '360.00'],
    // 50 × 100/400 = 12,50 a la primera línea; la última, lo que falta (37,50).
    // 49,99 × 100/400 = 12,4975 → 12,50; la última, 37,49.
    [{ type: 'monto', value: '50' } as const, ['87.50', '262.50'], '50.00', '350.00'],
    [{ type: 'monto', value: '49.99' } as const, ['87.50', '262.51'], '49.99', '350.01'],
  ])('descuento %j → líneas %j, descuento %s, total %s', (discount, finals, manual, total) => {
    const sale = computeSale(lines, discount);
    expect(sale.lines.map((l) => money(l.final))).toStrictEqual(finals);
    expect([money(sale.subtotal), money(sale.promoDiscount)]).toStrictEqual(['400.00', '100.00']);
    expect([money(sale.manualDiscount), money(sale.total)]).toStrictEqual([manual, total]);
  });

  it('cantidades con decimales se redondean por ítem', () => {
    const sale = computeSale([line('q', '0.750', '1234.56'), line('r', '0.333', '10')]);
    expect(sale.lines.map((l) => money(l.gross))).toStrictEqual(['925.92', '3.33']);
    expect(money(sale.total)).toBe('929.25');
  });

  it('un descuento de 10,00 entre tres ítems iguales suma exactamente 10,00', () => {
    const sale = computeSale([line('a', '1', '10'), line('b', '1', '10'), line('c', '1', '10')], {
      type: 'monto',
      value: '10',
    });
    expect(sale.lines.map((l) => money(l.manualDiscount))).toStrictEqual(['3.33', '3.34', '3.33']);
    expect(money(sale.total)).toBe('20.00');
  });

  it.each([
    [{ type: 'monto', value: '400.01' } as const],
    [{ type: 'porcentaje', value: '-5' } as const],
  ])('rechaza el descuento %j', (discount) => {
    expect(() => computeSale(lines, discount)).toThrow(
      expect.objectContaining({ code: 'DESCUENTO_INVALIDO' }),
    );
  });
});

describe('[RF-069] [RF-122] fracciones por medio de pago y base del IVA', () => {
  it('pago mixto: el recargo se calcula solo sobre la fracción de la tarjeta', () => {
    const plan = planPayment(cents('1000'), [
      { id: 'efectivo', cash: true, adjustmentPct: '0', amount: '600' },
      { id: 'tarjeta', cash: false, adjustmentPct: '10', amount: '400' },
    ]);
    expect(plan.fractions.map((f) => [money(f.adjustment), money(f.charged)])).toStrictEqual([
      ['0.00', '600.00'],
      ['40.00', '440.00'],
    ]);
    expect([money(plan.adjustment), money(plan.totalToCharge)]).toStrictEqual(['40.00', '1040.00']);
  });

  it('un descuento por pago en efectivo se redondea por fracción', () => {
    // 333,33 × −5 % = −16,6665 → −16,67.
    const plan = planPayment(cents('1000'), [
      { id: 'efectivo', cash: true, adjustmentPct: '-5', amount: '333.33' },
      { id: 'debito', cash: false, adjustmentPct: '0', amount: '666.67' },
    ]);
    expect(m(plan.fractions.map((f) => f.charged))).toStrictEqual(['316.66', '666.67']);
    expect(money(plan.totalToCharge)).toBe('983.33');
  });

  it('el recargo integra la base del IVA, prorrateado entre las líneas', () => {
    const inputs = [line('a', '1', '800', '0', '21'), line('b', '1', '200', '0', '10.5')];
    const totals = computeSale(inputs);
    const { parts, byRate } = vatBreakdown(inputs, totals, cents('40'));
    // 40 → 32 y 8. 832 / 1,21 = 687,60; 208 / 1,105 = 188,24.
    expect(parts.map((p) => [money(p.taxed), money(p.net), money(p.vat)])).toStrictEqual([
      ['832.00', '687.60', '144.40'],
      ['208.00', '188.24', '19.76'],
    ]);
    expect(byRate.map((r) => [r.rate, money(r.vat)])).toStrictEqual([
      ['21.0000', '144.40'],
      ['10.5000', '19.76'],
    ]);
  });
});

describe('[RF-070] [RF-071] cobertura de cada fracción y vuelto', () => {
  const fractions = (cashTendered: string | null, cardTendered: string | null) => [
    { id: 'efectivo', cash: true, adjustmentPct: '0', amount: '600', tendered: cashTendered },
    { id: 'tarjeta', cash: false, adjustmentPct: '10', amount: '400', tendered: cardTendered },
  ];

  it('pago exacto y vuelto en efectivo', () => {
    expect(money(planPayment(cents('1000'), fractions(null, null)).change)).toBe('0.00');
    expect(money(planPayment(cents('1000'), fractions('1000', '440')).change)).toBe('400.00');
  });

  it.each([
    [fractions('599.99', null), 'PAGO_INSUFICIENTE'],
    [fractions(null, '430'), 'PAGO_INSUFICIENTE'],
    [fractions(null, '450'), 'PAGO_EXCEDIDO'],
  ])('rechaza %j', (inputs, code) => {
    expect(() => planPayment(cents('1000'), inputs)).toThrow(expect.objectContaining({ code }));
  });

  it('las fracciones tienen que sumar el total de la venta', () => {
    expect(() =>
      planPayment(cents('1000'), [{ id: 'e', cash: true, adjustmentPct: '0', amount: '999.99' }]),
    ).toThrow(expect.objectContaining({ code: 'FRACCIONES_NO_CUADRAN' }));
  });
});

describe('[RF-124] IVA de combos prorrateado según el precio de lista', () => {
  const combo = (parts: [string, string, string, string][]): SaleLineInput => ({
    id: 'combo',
    quantity: '1',
    unitPrice: '3500',
    promoDiscount: '0',
    vatRate: null,
    comboParts: parts.map(([productId, vatRate, listPrice, quantity]) => ({
      productId,
      vatRate,
      listPrice,
      quantity,
    })),
  });

  it('un combo que mezcla 10,5 % y 21 %', () => {
    // Leche 1000 × 1 y galletitas 500 × 2: pesos iguales, 1750 cada parte.
    const input = combo([
      ['leche', '10.5', '1000', '1'],
      ['galletitas', '21', '500', '2'],
    ]);
    const { parts } = vatBreakdown([input], computeSale([input]));
    expect(
      parts.map((p) => [p.productId, money(p.taxed), money(p.net), money(p.vat)]),
    ).toStrictEqual([
      ['leche', '1750.00', '1583.71', '166.29'],
      ['galletitas', '1750.00', '1446.28', '303.72'],
    ]);
  });

  it('el prorrateo suma el precio del combo', () => {
    const parts = splitCombo(
      combo([
        ['a', '21', '1000', '1'],
        ['b', '0', '300', '1'],
      ]),
      cents('3500'),
    );
    expect(parts.map((p) => money(p.taxed))).toStrictEqual(['2692.31', '807.69']);
  });
});

describe('[RF-085] [RF-086] reintegro proporcional de una devolución', () => {
  const fractions = [
    { id: 'efectivo', creditAccount: false, charged: cents('600') },
    { id: 'tarjeta', creditAccount: false, charged: cents('440') },
  ];

  it('una devolución parcial y después la total devuelven exactamente lo cobrado', () => {
    const first = refundByFraction(cents('1000'), fractions, 0n, cents('250'));
    expect(first.map((f) => money(f.refund))).toStrictEqual(['150.00', '110.00']);
    const rest = refundByFraction(cents('1000'), fractions, cents('250'), cents('750'));
    expect(rest.map((f) => money(f.refund))).toStrictEqual(['450.00', '330.00']);
  });

  it('tres devoluciones de un tercio suman lo cobrado', () => {
    const card = [{ id: 'tarjeta', creditAccount: false, charged: cents('310') }];
    const steps = [0, 1, 2].map(
      (i) =>
        refundByFraction(cents('300'), card, cents('100') * BigInt(i), cents('100'))[0]?.refund ??
        0n,
    );
    expect(m(steps)).toStrictEqual(['103.33', '103.34', '103.33']);
  });

  it('el valor de las unidades devueltas de una línea', () => {
    const steps = [0, 1, 2].map((i) => returnedLineValue(cents('100'), '3', String(i), '1'));
    expect(m(steps)).toStrictEqual(['33.33', '33.34', '33.33']);
    expect(() => returnedLineValue(cents('100'), '3', '2', '2')).toThrow(
      expect.objectContaining({ code: 'DEVOLUCION_EXCEDIDA' }),
    );
  });

  it.each([
    ['500', '300', '300.00', '200.00', true],
    ['500', '800', '500.00', '0.00', false],
    ['500', '0', '0.00', '500.00', true],
  ])(
    'crédito ya pagado: reintegro %s con saldo %s → baja %s, efectivo %s',
    (refund, balance, reduction, cash, authorization) => {
      const result = creditRefund(cents(refund), cents(balance));
      expect([money(result.balanceReduction), money(result.cashExcess)]).toStrictEqual([
        reduction,
        cash,
      ]);
      expect(result.requiresAuthorization).toBe(authorization);
    },
  );
});
