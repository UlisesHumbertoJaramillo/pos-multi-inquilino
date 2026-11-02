// Bloqueo de credenciales (RF-145, D-43): 5 intentos fallidos seguidos bloquean la credencial
// (contraseña o PIN) durante 15 minutos. Un éxito reinicia la cuenta, y al terminar el bloqueo
// la cuenta vuelve a cero. Los intentos rechazados por estar bloqueado no cuentan.
export interface LockoutPolicy {
  maxConsecutiveFailures: number;
  lockMs: number;
}

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = {
  maxConsecutiveFailures: 5,
  lockMs: 15 * 60_000,
};

export type AttemptResult = 'exito' | 'fallo' | 'bloqueado';

export interface Attempt {
  at: Date;
  result: AttemptResult;
}

export interface LockoutState {
  lockedUntil: Date | null;
  consecutiveFailures: number;
}

// `attempts` en cualquier orden. Devuelve el estado que resulta de aplicarlos en orden temporal.
export function lockoutState(
  attempts: readonly Attempt[],
  policy: LockoutPolicy = DEFAULT_LOCKOUT_POLICY,
): LockoutState {
  let failures = 0;
  let lockedUntil: Date | null = null;
  const ordered = [...attempts].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const attempt of ordered) {
    if (lockedUntil !== null && attempt.at >= lockedUntil) {
      lockedUntil = null;
      failures = 0;
    }
    if (attempt.result === 'exito') {
      failures = 0;
    } else if (attempt.result === 'fallo' && lockedUntil === null) {
      failures++;
      if (failures >= policy.maxConsecutiveFailures) {
        lockedUntil = new Date(attempt.at.getTime() + policy.lockMs);
        failures = 0;
      }
    }
  }
  return { lockedUntil, consecutiveFailures: failures };
}

export function isLocked(state: LockoutState, now: Date): boolean {
  return state.lockedUntil !== null && now < state.lockedUntil;
}
