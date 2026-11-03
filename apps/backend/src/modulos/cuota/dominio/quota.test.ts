// Cuota de descuento: límites, recorte por el tope, ajuste del saldo y control de un descuento
// (T-124 a T-126; RF-063 a RF-066, RF-142, D-32, D-72 a D-74).
import { describe, expect, it } from 'vitest';
import {
  adjustedBalance,
  assertNotSelfAssigned,
  assertWithinCap,
  checkDiscount,
  clampToCap,
  normalizeLimits,
  type QuotaLimits,
} from './quota.js';

const limits = (percent: string, amount: string): QuotaLimits => ({ percent, amount });

describe('[RF-063] [RF-064] límites del tope y de la cuota', () => {
  it('normaliza el porcentaje y el monto', () => {
    expect(normalizeLimits(limits('10', '1500'))).toEqual(limits('10.0000', '1500.00'));
  });

  it.each([
    ['101', '0'],
    ['-1', '0'],
    ['10', '-5'],
    ['10.12345', '0'],
    ['10', '1.001'],
  ])('rechaza %s %% y $ %s', (percent, amount) => {
    expect(() => normalizeLimits(limits(percent, amount))).toThrow();
  });

  it('una cuota dentro del tope se acepta, una que supera algún límite no', () => {
    const cap = limits('15.0000', '5000.00');
    expect(() => {
      assertWithinCap(limits('15.0000', '5000.00'), cap);
    }).not.toThrow();
    expect(() => {
      assertWithinCap(limits('15.0001', '100.00'), cap);
    }).toThrow(expect.objectContaining({ code: 'CUOTA_SUPERA_TOPE' }));
    expect(() => {
      assertWithinCap(limits('5.0000', '5000.01'), cap);
    }).toThrow(expect.objectContaining({ code: 'CUOTA_SUPERA_TOPE' }));
  });
});

describe('[RF-142] recorte al bajar el tope', () => {
  const cap = limits('10.0000', '1000.00');

  it.each([
    [limits('20.0000', '500.00'), limits('10.0000', '500.00')],
    [limits('5.0000', '3000.00'), limits('5.0000', '1000.00')],
    [limits('25.0000', '9000.00'), limits('10.0000', '1000.00')],
  ])('recorta %o a %o', (quota, expected) => {
    expect(clampToCap(quota, cap)).toEqual(expected);
  });

  it('una cuota que entra en el tope no cambia', () => {
    expect(clampToCap(limits('10.0000', '1000.00'), cap)).toBeNull();
  });
});

describe('[D-73] ajuste del saldo del día al cambiar el monto', () => {
  it.each([
    ['600.00', '1000.00', '1500.00', '1100.00'],
    ['600.00', '1000.00', '500.00', '100.00'],
    ['100.00', '1000.00', '500.00', '0.00'],
    ['0.00', '0.00', '800.00', '800.00'],
  ])('saldo %s, de %s a %s → %s', (balance, previous, next, expected) => {
    expect(adjustedBalance(balance, previous, next)).toBe(expected);
  });
});

describe('[RF-065] [RF-066] control de un descuento contra la cuota', () => {
  const quota = limits('10.0000', '1000.00');

  it('dentro del porcentaje y del saldo', () => {
    expect(
      checkDiscount(
        { subtotal: '5000.00', amount: '500.00', enteredPercent: null },
        quota,
        '500.00',
      ),
    ).toEqual({ withinQuota: true });
  });

  it('sobre el porcentaje por venta', () => {
    expect(
      checkDiscount(
        { subtotal: '5000.00', amount: '500.01', enteredPercent: null },
        quota,
        '900.00',
      ),
    ).toEqual({ withinQuota: false, reasons: ['porcentaje'] });
  });

  it('sin saldo suficiente', () => {
    expect(
      checkDiscount(
        { subtotal: '5000.00', amount: '300.00', enteredPercent: null },
        quota,
        '299.99',
      ),
    ).toEqual({ withinQuota: false, reasons: ['saldo'] });
  });

  it('sobre los dos límites', () => {
    expect(
      checkDiscount({ subtotal: '1000.00', amount: '200.00', enteredPercent: null }, quota, '0.00'),
    ).toEqual({ withinQuota: false, reasons: ['porcentaje', 'saldo'] });
  });

  it('un porcentaje ingresado se compara tal cual, aunque el monto redondee hacia arriba', () => {
    // 10 % de 33,35 es 3,335 → 3,34, que es el 10,015 %: igual entra en la cuota.
    expect(
      checkDiscount({ subtotal: '33.35', amount: '3.34', enteredPercent: '10' }, quota, '1000.00'),
    ).toEqual({ withinQuota: true });
    expect(
      checkDiscount({ subtotal: '33.35', amount: '3.34', enteredPercent: null }, quota, '1000.00'),
    ).toEqual({ withinQuota: false, reasons: ['porcentaje'] });
  });

  it('[D-72] sin cuota asignada, todo descuento queda fuera de ella', () => {
    expect(
      checkDiscount(
        { subtotal: '100.00', amount: '0.01', enteredPercent: null },
        limits('0.0000', '0.00'),
        '0.00',
      ),
    ).toEqual({ withinQuota: false, reasons: ['porcentaje', 'saldo'] });
  });

  it('un descuento negativo o mayor que la venta se rechaza', () => {
    expect(() =>
      checkDiscount({ subtotal: '100.00', amount: '100.01', enteredPercent: null }, quota, '500'),
    ).toThrow(expect.objectContaining({ code: 'DESCUENTO_INVALIDO' }));
    expect(() =>
      checkDiscount({ subtotal: '100.00', amount: '-1.00', enteredPercent: null }, quota, '500'),
    ).toThrow(expect.objectContaining({ code: 'DESCUENTO_INVALIDO' }));
  });
});

describe('[D-74] un AS no se asigna su propia cuota', () => {
  it('rechaza la autoasignación', () => {
    expect(() => {
      assertNotSelfAssigned('u1', 'u1');
    }).toThrow(expect.objectContaining({ code: 'AUTOASIGNACION' }));
    expect(() => {
      assertNotSelfAssigned('u1', 'u2');
    }).not.toThrow();
  });
});
