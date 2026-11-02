import { describe, expect, it } from 'vitest';
import { isLocked, lockoutState, type Attempt, type AttemptResult } from './lockout.js';

const START = new Date('2026-11-02T12:00:00.000Z').getTime();
const MINUTE = 60_000;

function attempts(...results: [number, AttemptResult][]): Attempt[] {
  return results.map(([minute, result]) => ({ at: new Date(START + minute * MINUTE), result }));
}

describe('[RF-145] bloqueo de credenciales', () => {
  it('cuatro fallos seguidos no bloquean', () => {
    const state = lockoutState(attempts([0, 'fallo'], [1, 'fallo'], [2, 'fallo'], [3, 'fallo']));

    expect(state).toStrictEqual({ lockedUntil: null, consecutiveFailures: 4 });
  });

  it('el quinto fallo seguido bloquea durante 15 minutos', () => {
    const state = lockoutState(
      attempts([0, 'fallo'], [1, 'fallo'], [2, 'fallo'], [3, 'fallo'], [4, 'fallo']),
    );

    expect(state.lockedUntil).toStrictEqual(new Date(START + 19 * MINUTE));
    expect(isLocked(state, new Date(START + 18 * MINUTE))).toBe(true);
    expect(isLocked(state, new Date(START + 19 * MINUTE))).toBe(false);
  });

  it('un éxito reinicia la cuenta de fallos', () => {
    const state = lockoutState(
      attempts([0, 'fallo'], [1, 'fallo'], [2, 'fallo'], [3, 'fallo'], [4, 'exito'], [5, 'fallo']),
    );

    expect(state).toStrictEqual({ lockedUntil: null, consecutiveFailures: 1 });
  });

  it('al terminar el bloqueo la cuenta vuelve a cero', () => {
    const state = lockoutState(
      attempts([0, 'fallo'], [1, 'fallo'], [2, 'fallo'], [3, 'fallo'], [4, 'fallo'], [20, 'fallo']),
    );

    expect(state).toStrictEqual({ lockedUntil: null, consecutiveFailures: 1 });
  });

  it('los intentos rechazados durante el bloqueo no lo extienden', () => {
    const state = lockoutState(
      attempts(
        [0, 'fallo'],
        [1, 'fallo'],
        [2, 'fallo'],
        [3, 'fallo'],
        [4, 'fallo'],
        [10, 'bloqueado'],
        [18, 'bloqueado'],
      ),
    );

    expect(state.lockedUntil).toStrictEqual(new Date(START + 19 * MINUTE));
  });

  it('no depende del orden en que llegan los intentos', () => {
    const ordered = attempts([0, 'fallo'], [1, 'fallo'], [2, 'fallo'], [3, 'fallo'], [4, 'fallo']);

    expect(lockoutState([...ordered].reverse())).toStrictEqual(lockoutState(ordered));
  });
});
