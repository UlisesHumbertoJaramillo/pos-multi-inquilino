// Sucursales y cajas del comercio (RF-023 a RF-025, RF-027).
import { DomainError } from '../../../compartido/dominio/errors.js';

export interface Branch {
  id: string;
  tenantId: string;
  name: string;
  address: string | null;
  isActive: boolean;
}

export interface Register {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  // Punto de venta de ARCA. Opcional sin el módulo de facturación.
  fiscalPointOfSale: number | null;
  isActive: boolean;
}

export function assertName(value: string, max: number, what: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new DomainError(
      'NOMBRE_INVALIDO',
      `${what} tiene que tener entre 1 y ${String(max)} caracteres.`,
    );
  }
  return trimmed;
}

export function assertAddress(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    throw new DomainError(
      'DIRECCION_INVALIDA',
      'La dirección tiene que tener hasta 200 caracteres.',
    );
  }
  return trimmed === '' ? null : trimmed;
}

export function assertPointOfSale(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1 || value > 99_999) {
    throw new DomainError(
      'PUNTO_DE_VENTA_INVALIDO',
      'El punto de venta tiene que ser un número entre 1 y 99999.',
    );
  }
  return value;
}

// Lo que impide dar de baja una sucursal o una caja (RF-025).
export interface Dependencies {
  openShifts: number;
  carts: number;
  pendingTransfers: number;
  // Productos con stock disponible, en revisión o en tránsito (solo cuenta para una sucursal).
  stockedProducts: number;
}

export const NO_DEPENDENCIES: Dependencies = {
  openShifts: 0,
  carts: 0,
  pendingTransfers: 0,
  stockedProducts: 0,
};

export function assertNoDependencies(what: string, dependencies: Dependencies): void {
  const blockers = [
    dependencies.openShifts > 0 ? `${String(dependencies.openShifts)} turno(s) abierto(s)` : null,
    dependencies.carts > 0 ? `${String(dependencies.carts)} venta(s) en curso` : null,
    dependencies.pendingTransfers > 0
      ? `${String(dependencies.pendingTransfers)} transferencia(s) pendiente(s)`
      : null,
    dependencies.stockedProducts > 0
      ? `${String(dependencies.stockedProducts)} producto(s) con stock`
      : null,
  ].filter((blocker) => blocker !== null);
  if (blockers.length > 0) {
    throw new DomainError(
      'BAJA_CON_DEPENDENCIAS',
      `No se puede dar de baja ${what}: tiene ${blockers.join(', ')}.`,
    );
  }
}
