// Parámetros del módulo de identidad.
import { DEFAULT_LOCKOUT_POLICY, type LockoutPolicy } from '../dominio/lockout.js';

export interface IdentityConfig {
  // Cierre de sesión por inactividad (RF-009). Hasta que exista el parámetro del comercio
  // (RF-135, E2), se usa el valor de la plataforma.
  sessionIdleMs: number;
  // Duración máxima de una sesión, aunque haya actividad.
  sessionMaxMs: number;
  validationTokenTtlMs: number;
  recoveryTokenTtlMs: number;
  // Dirección del frontend, para los enlaces de los correos.
  appPublicUrl: string;
  lockout: LockoutPolicy;
}

export const DEFAULT_IDENTITY_CONFIG: Omit<IdentityConfig, 'appPublicUrl'> = {
  sessionIdleMs: 30 * 60_000,
  sessionMaxMs: 12 * 60 * 60_000,
  validationTokenTtlMs: 48 * 60 * 60_000,
  recoveryTokenTtlMs: 60 * 60_000,
  lockout: DEFAULT_LOCKOUT_POLICY,
};
