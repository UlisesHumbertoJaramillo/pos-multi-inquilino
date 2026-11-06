import { describe, expect, it } from 'vitest';
import {
  assertNoDebt,
  availableCredit,
  normalizeCollection,
  normalizeCreditLimit,
  normalizeCustomer,
} from './customers.js';

describe('[RF-132] datos del cliente', () => {
  it('recorta la razón social y un documento vacío queda sin documento', () => {
    expect(
      normalizeCustomer({ name: ' Ana ', document: '  ', fiscalCondition: 'exento' }),
    ).toStrictEqual({ name: 'Ana', document: null, fiscalCondition: 'exento' });
  });

  it('exige la razón social', () => {
    expect(() =>
      normalizeCustomer({ name: ' ', document: null, fiscalCondition: 'exento' }),
    ).toThrow('razón social');
  });
});

describe('[RF-072] crédito', () => {
  it('el límite no puede ser negativo', () => {
    expect(normalizeCreditLimit('1500')).toBe('1500.00');
    expect(() => normalizeCreditLimit('-1')).toThrow('negativo');
  });

  it('el disponible es el límite menos el saldo, y nunca negativo', () => {
    expect(availableCredit('1000.00', '300.00')).toBe('700.00');
    expect(availableCredit('1000.00', '1200.00')).toBe('0.00');
  });

  it('con deuda no se hacen cambios que la pierdan', () => {
    expect(() => {
      assertNoDebt('0.01');
    }).toThrow('adeuda');
    expect(() => {
      assertNoDebt('0.00');
    }).not.toThrow();
  });
});

describe('[RF-129] monto de un cobro', () => {
  it('tiene que ser mayor que cero', () => {
    expect(normalizeCollection('10')).toBe('10.00');
    expect(() => normalizeCollection('0')).toThrow('mayor que cero');
  });
});
