// Protección contra la fuerza bruta de contraseñas y PIN (T-034, T-045, RF-145).
import type { TechnicalAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import { isLocked, lockoutState, type LockoutPolicy } from '../dominio/lockout.js';
import type { AccessAttemptRepository, CredentialType } from './ports.js';

export interface AttemptOrigin {
  ip: string | null;
  actorId?: string | null;
  tenantId?: string | null;
}

// Ventana de historial que se mira para calcular el bloqueo.
const HISTORY_MS = 24 * 60 * 60_000;

export function lockedError(until: Date, now: Date): ApplicationError {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  return new ApplicationError(
    'locked',
    'CREDENCIAL_BLOQUEADA',
    `La credencial está bloqueada por intentos fallidos. Probá de nuevo en ${String(minutes)} minuto(s).`,
  );
}

export class CredentialGuard {
  constructor(
    private readonly attempts: AccessAttemptRepository,
    private readonly audit: TechnicalAuditLog,
    private readonly clock: Clock,
    private readonly policy: LockoutPolicy,
  ) {}

  // Rechaza el intento sin mirar la credencial si está bloqueada.
  async assertNotLocked(
    type: CredentialType,
    identifier: string,
    origin: AttemptOrigin,
  ): Promise<void> {
    const now = this.clock.now();
    const state = await this.state(type, identifier, now);
    if (state.lockedUntil !== null && isLocked(state, now)) {
      await this.attempts.record({ type, identifier, result: 'bloqueado', ip: origin.ip, at: now });
      throw lockedError(state.lockedUntil, now);
    }
  }

  async recordSuccess(
    type: CredentialType,
    identifier: string,
    origin: AttemptOrigin,
  ): Promise<void> {
    await this.attempts.record({
      type,
      identifier,
      result: 'exito',
      ip: origin.ip,
      at: this.clock.now(),
    });
  }

  // Registra el fallo. Si con él se bloquea la credencial, lo registra en la auditoría técnica
  // y devuelve hasta cuándo queda bloqueada.
  async recordFailure(
    type: CredentialType,
    identifier: string,
    origin: AttemptOrigin,
  ): Promise<Date | null> {
    const now = this.clock.now();
    await this.attempts.record({ type, identifier, result: 'fallo', ip: origin.ip, at: now });
    const state = await this.state(type, identifier, now);
    if (state.lockedUntil === null || !isLocked(state, now)) return null;
    await this.audit.record({
      type: 'credencial_bloqueada',
      actorId: origin.actorId ?? null,
      tenantId: origin.tenantId ?? null,
      ip: origin.ip,
      detail: { credential: type, lockedUntil: state.lockedUntil.toISOString() },
    });
    return state.lockedUntil;
  }

  private async state(type: CredentialType, identifier: string, now: Date) {
    const history = await this.attempts.recent(
      type,
      identifier,
      new Date(now.getTime() - HISTORY_MS),
    );
    return lockoutState(history, this.policy);
  }
}
