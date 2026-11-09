import { describe, expect, it } from 'vitest';
import { isChange, normalize, type PeripheralReport } from './peripherals.js';

const failure: PeripheralReport = {
  device: 'impresora',
  connection: 'usb',
  state: 'falla',
  reason: 'desconectada',
};

describe('[RF-016] cambios de estado de un periférico', () => {
  it('la primera falla se registra; un primer estado correcto no', () => {
    expect(isChange(null, failure)).toBe(true);
    expect(isChange(null, { ...failure, state: 'ok', reason: null })).toBe(false);
  });

  it('repetir el mismo estado no se registra; otro motivo o la recuperación sí', () => {
    const previous = { state: 'falla' as const, reason: 'desconectada' as const };
    expect(isChange(previous, failure)).toBe(false);
    expect(isChange(previous, { ...failure, reason: 'sin_papel' })).toBe(true);
    expect(isChange(previous, { ...failure, state: 'ok', reason: null })).toBe(true);
  });

  it('un periférico que funciona no lleva motivo', () => {
    expect(normalize({ ...failure, state: 'ok' }).reason).toBeNull();
    expect(normalize(failure).reason).toBe('desconectada');
  });
});
