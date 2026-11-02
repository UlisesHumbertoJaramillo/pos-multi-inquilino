// Bajas lógicas (T-023, Const. 5, RF-020): una entidad dada de baja deja de estar activa,
// pero se conserva con quién y cuándo la dio de baja. Nunca se elimina.
import { DomainError } from './errors.js';

export interface Activation {
  isActive: boolean;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
}

export const ACTIVE: Activation = { isActive: true, deactivatedAt: null, deactivatedBy: null };

export function deactivate(current: Activation, by: string, at: Date): Activation {
  if (!current.isActive) {
    throw new DomainError('YA_DADO_DE_BAJA', 'El registro ya está dado de baja.');
  }
  return { isActive: false, deactivatedAt: at, deactivatedBy: by };
}
