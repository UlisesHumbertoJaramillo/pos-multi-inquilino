// Caja: fecha y vencimiento de la jornada, saldo teórico, arqueo y tolerancia
// (T-130, T-134, T-137, T-140; RF-089, RF-094, RF-098, RF-112, RF-118).
import { describe, expect, it } from 'vitest';
import {
  type CashMovement,
  countCash,
  exceedsTolerance,
  journeyDate,
  journeyExpired,
  normalizeAmount,
  normalizeReason,
  openingDifference,
  theoreticalCash,
  withdrawalCovered,
} from './cash.js';

const cash = (type: CashMovement['type'], amount: string, inCash = true): CashMovement => ({
  type,
  amount,
  inCash,
});

describe('[RF-118] fecha de la jornada en la zona horaria del comercio', () => {
  it.each([
    ['2026-11-03T02:30:00Z', 'America/Argentina/Buenos_Aires', '2026-11-02'],
    ['2026-11-03T03:00:00Z', 'America/Argentina/Buenos_Aires', '2026-11-03'],
    ['2026-11-02T23:30:00Z', 'Europe/Madrid', '2026-11-03'],
    ['2026-11-02T23:30:00Z', 'UTC', '2026-11-02'],
  ])('%s en %s es %s', (at, zone, expected) => {
    expect(journeyDate(new Date(at), zone)).toBe(expected);
  });
});

describe('[RF-097] [D-77] vencimiento de la jornada', () => {
  const opened = new Date('2026-11-02T08:00:00Z');

  it('se continúa pasada la medianoche, hasta 24 h después de abierta', () => {
    expect(journeyExpired(opened, new Date('2026-11-03T01:00:00Z'))).toBe(false);
    expect(journeyExpired(opened, new Date('2026-11-03T07:59:59Z'))).toBe(false);
  });

  it('a las 24 h exige el Corte Z', () => {
    expect(journeyExpired(opened, new Date('2026-11-03T08:00:00Z'))).toBe(true);
  });
});

describe('[RF-112] saldo teórico de efectivo', () => {
  it.each([
    ['solo saldo inicial', '1000.00', [], '1000.00'],
    [
      'ingresos y retiros',
      '1000.00',
      [cash('ingreso', '500'), cash('retiro', '300.50')],
      '1199.50',
    ],
    [
      'ventas en efectivo y electrónicas',
      '0',
      [cash('venta', '1200'), cash('venta', '800', false), cash('venta', '99.99')],
      '1299.99',
    ],
    [
      'reintegros, anulaciones y cobros',
      '500',
      [
        cash('cobro', '250'),
        cash('reintegro', '100'),
        cash('anulacion', '50'),
        cash('cobro', '70', false),
      ],
      '600.00',
    ],
  ])('%s', (_name, initial, movements, expected) => {
    expect(theoreticalCash(initial, movements)).toBe(expected);
  });
});

describe('[RF-094] arqueo', () => {
  it.each([
    ['1500.00', '1500.00', '0.00', 'cuadrado'],
    ['1450.00', '1500.00', '-50.00', 'faltante'],
    ['1500.01', '1500.00', '0.01', 'sobrante'],
  ])('declarado %s contra teórico %s', (declared, theoretical, difference, result) => {
    expect(countCash(declared, theoretical)).toEqual({
      declared,
      theoretical,
      difference,
      result,
    });
  });
});

describe('[RF-098] tolerancia del arqueo', () => {
  it.each([
    ['0.01', '0', true],
    ['-0.01', '0', true],
    ['0.00', '0', false],
    ['-50.00', '100', false],
    ['100.00', '100', false],
    ['-100.01', '100', true],
  ])('diferencia %s con tolerancia %s → %s', (difference, tolerance, expected) => {
    expect(exceedsTolerance(difference, tolerance)).toBe(expected);
  });
});

describe('[RF-089] [D-75] diferencia del saldo inicial', () => {
  it('el primer turno de la jornada no se compara', () => {
    expect(openingDifference('1000', null)).toBeNull();
  });

  it('se compara con lo declarado en el Corte X anterior', () => {
    expect(openingDifference('1000.00', '1000.00')).toBeNull();
    expect(openingDifference('950.00', '1000.00')).toBe('-50.00');
    expect(openingDifference('1010', '1000.00')).toBe('10.00');
  });
});

describe('[RF-091] [RF-092] movimientos manuales', () => {
  it('el monto es positivo y el motivo obligatorio', () => {
    expect(normalizeAmount('150.5', 'El monto', false)).toBe('150.50');
    expect(() => normalizeAmount('0', 'El monto', false)).toThrow();
    expect(() => normalizeAmount('-1', 'El monto', true)).toThrow();
    expect(normalizeAmount('0', 'Lo declarado', true)).toBe('0.00');
    expect(normalizeReason('  Cambio  ')).toBe('Cambio');
    expect(() => normalizeReason('   ')).toThrow();
  });

  it('un retiro no supera el teórico', () => {
    expect(withdrawalCovered('500.00', '500.00')).toBe(true);
    expect(withdrawalCovered('500.01', '500.00')).toBe(false);
  });
});
