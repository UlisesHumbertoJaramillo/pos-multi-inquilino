import { describe, expect, it } from 'vitest';
import { ManualClock } from '../../../../test/support/clock.js';
import { uuidGenerator } from '../id/uuid-generator.js';
import { systemClock } from './system-clock.js';

describe('Clock', () => {
  it('el reloj del sistema devuelve la hora actual', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('el reloj simulado solo avanza cuando se le indica', () => {
    const clock = new ManualClock('2026-11-02T12:00:00.000Z');

    clock.advance(90_000);

    expect(clock.now().toISOString()).toBe('2026-11-02T12:01:30.000Z');
    clock.set('2026-12-31T23:59:59.000Z');
    expect(clock.now().toISOString()).toBe('2026-12-31T23:59:59.000Z');
  });

  it('el reloj simulado no se puede modificar a través de la fecha que devuelve', () => {
    const clock = new ManualClock('2026-11-02T12:00:00.000Z');

    clock.now().setFullYear(2000);

    expect(clock.now().getFullYear()).toBe(2026);
  });
});

describe('IdGenerator', () => {
  it('genera UUID distintos', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidGenerator.next()));

    expect(ids.size).toBe(1000);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});
