import { describe, expect, it } from 'vitest';
import { assertReturnWindow, assertVoidable, componentQuantity } from './returns.js';

const voidable = {
  state: 'confirmada',
  shiftOpen: true,
  sameShift: true,
  hasReturns: false,
  partial: false,
};

describe('[RF-136] condiciones de la anulación', () => {
  it('una venta entera, en su turno y sin devoluciones se anula', () => {
    expect(() => {
      assertVoidable(voidable);
    }).not.toThrow();
  });

  it.each([
    ['fuera de su turno', { sameShift: false }],
    ['con el turno cerrado', { shiftOpen: false }],
    ['parcial', { partial: true }],
    ['con devoluciones previas', { hasReturns: true }],
  ])('%s corresponde una devolución', (_, change) => {
    expect(() => {
      assertVoidable({ ...voidable, ...change });
    }).toThrow('corresponde una devolución');
  });

  it('solo se anula una venta confirmada', () => {
    expect(() => {
      assertVoidable({ ...voidable, state: 'anulada' });
    }).toThrow('confirmada');
  });
});

describe('[RF-138] plazo de devolución', () => {
  it('cuenta en días desde la fecha de jornada', () => {
    expect(() => {
      assertReturnWindow('2026-11-02', 30, '2026-12-02');
    }).not.toThrow();
    expect(() => {
      assertReturnWindow('2026-11-02', 30, '2026-12-03');
    }).toThrow('Venció');
  });
});

describe('[RF-051] componentes de un combo devuelto', () => {
  it('multiplica las unidades por combo', () => {
    expect(componentQuantity('2.000', '3.000')).toBe('6.000');
    expect(componentQuantity('0.500', '1.000')).toBe('0.500');
  });
});
