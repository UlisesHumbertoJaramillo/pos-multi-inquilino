// Puertos del módulo de caja (plan §2.14).
import type { CashCount, CashMovement } from '../dominio/cash.js';

export interface Register {
  id: string;
  branchId: string;
  name: string;
  isActive: boolean;
}

export interface Journey {
  id: string;
  tenantId: string;
  registerId: string;
  branchId: string;
  date: string;
  openedAt: Date;
  status: 'abierta' | 'cerrada';
}

export interface Shift {
  id: string;
  tenantId: string;
  registerId: string;
  registerName: string;
  branchId: string;
  journeyId: string;
  journeyDate: string;
  sellerId: string;
  sellerName: string;
  initial: string;
  previousCash: string | null;
  openingDifference: string | null;
  openedAt: Date;
  status: 'abierto' | 'cerrado';
  count: CashCount | null;
  closedAt: Date | null;
  closedBy: string | null;
  forced: boolean;
}

export interface StoredMovement extends CashMovement {
  id: string;
  shiftId: string;
  methodId?: string | null;
  reason: string | null;
  authorizationId: string | null;
  userId: string;
  at: Date;
}

export interface RegisterStatus extends Register {
  journey: Pick<Journey, 'id' | 'date' | 'openedAt'> | null;
  openShift: Pick<Shift, 'id' | 'sellerId' | 'sellerName' | 'openedAt'> | null;
}

export interface CashRepository {
  // Bloquea la caja hasta el fin de la transacción: serializa aperturas y cortes de esa caja.
  lockRegister(tenantId: string, id: string): Promise<Register | undefined>;
  branchExists(tenantId: string, branchId: string): Promise<boolean>;
  registers(tenantId: string, branchId: string): Promise<RegisterStatus[]>;
  openJourney(tenantId: string, registerId: string): Promise<Journey | undefined>;
  insertJourney(journey: Journey): Promise<void>;
  closeJourney(tenantId: string, id: string, count: CashCount, by: string, at: Date): Promise<void>;
  shiftsOfJourney(tenantId: string, journeyId: string): Promise<Shift[]>;
  openShiftOfSeller(tenantId: string, sellerId: string): Promise<Shift | undefined>;
  findShift(tenantId: string, id: string, lock: boolean): Promise<Shift | undefined>;
  // Devuelve false si la base rechaza un segundo turno abierto en la caja o del VO (RF-090, RF-154).
  insertShift(shift: Shift): Promise<boolean>;
  closeShift(
    tenantId: string,
    id: string,
    count: CashCount,
    by: string,
    at: Date,
    forced: boolean,
  ): Promise<void>;
  openShifts(tenantId: string, branchId: string): Promise<Shift[]>;
  addMovement(tenantId: string, movement: StoredMovement): Promise<void>;
  movements(tenantId: string, shiftIds: readonly string[]): Promise<StoredMovement[]>;
}

export interface CashSettings {
  tolerance(tenantId: string): Promise<string>;
  timeZone(tenantId: string): Promise<string>;
}

export type CashAlertType =
  | 'diferencia_apertura'
  | 'retiro_rechazado'
  | 'arqueo_fuera_de_tolerancia'
  | 'cierre_forzado'
  | 'jornada_sin_z';

export interface CashAlert {
  tenantId: string;
  branchId: string;
  recipientRole: 'AS' | 'AC';
  type: CashAlertType;
  severity: 'info' | 'advertencia' | 'critica';
  reference: string;
  detail: Record<string, unknown>;
  at: Date;
}

export interface CashAlerts {
  add(alert: CashAlert): Promise<void>;
  hasPending(tenantId: string, type: CashAlertType, reference: string): Promise<boolean>;
  resolve(
    tenantId: string,
    type: CashAlertType,
    reference: string,
    by: string,
    at: Date,
  ): Promise<void>;
}

export interface SaleInProgress {
  id: string;
  label: string;
}

// Puerto ConsultaVentasEnCurso: simulado hasta T-149, cuando existan las ventas.
export interface SalesInProgress {
  forShift(tenantId: string, shiftId: string): Promise<SaleInProgress[]>;
  forRegister(tenantId: string, registerId: string): Promise<SaleInProgress[]>;
  // Cierre forzado: descarta las ventas en curso del turno y libera sus reservas (RF-115).
  discardForShift(
    actor: { tenantId: string; userId: string; at: Date },
    shiftId: string,
  ): Promise<void>;
}

// Restablecimiento de la cuota del VO en el primer turno de la fecha de jornada (RF-067).
export interface ShiftQuota {
  openDay(
    actor: { tenantId: string; userId: string; at: Date },
    branchId: string,
    journeyDate: string,
  ): Promise<unknown>;
}

// Consumo de la autorización por PIN de un retiro (RF-092). Lo implementa identidad.
export interface WithdrawalAuthorizations {
  consume(input: {
    id: string;
    type: 'retiro';
    operationRef: string;
    requesterId: string;
  }): Promise<void>;
}
