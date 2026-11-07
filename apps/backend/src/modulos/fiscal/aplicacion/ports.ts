// Puertos del módulo fiscal (plan §2.15).
import type { IssuerCondition, VoucherClass } from '../dominio/vouchers.js';

export type VoucherState = 'pendiente' | 'aceptado' | 'rechazado' | 'bloqueado';

export interface Buyer {
  name: string | null;
  document: string | null;
  condition: string;
}

export interface Voucher {
  id: string;
  tenantId: string;
  type: 'factura' | 'nota_credito';
  voucherClass: VoucherClass | null;
  saleId: string;
  branchId: string;
  registerId: string;
  pointOfSale: number | null;
  number: number | null;
  total: string;
  buyer: Buyer;
  contingency: boolean;
  caeaCode: string | null;
  nonFiscal: boolean;
  cae: string | null;
  state: VoucherState;
  rejection: string | null;
  attempts: number;
  nextAttemptAt: Date;
  deadline: Date;
  issuedAt: Date;
  resolvedAt: Date | null;
  // Nota de Crédito: su factura original y la devolución o anulación que la originó.
  originalId: string | null;
  originId: string | null;
}

export interface VoucherRow extends Voucher {
  ticket: number | null;
}

export interface Credential {
  cuit: string;
  condition: IssuerCondition;
  certificate: string;
  key: string;
  expiresAt: Date;
}

export interface FiscalRepository {
  insert(voucher: Voucher): Promise<void>;
  find(tenantId: string, id: string, lock: boolean): Promise<Voucher | undefined>;
  forSale(tenantId: string, saleId: string): Promise<Voucher | undefined>;
  forOrigin(tenantId: string, originId: string): Promise<Voucher | undefined>;
  unblockCreditNotes(tenantId: string, originalId: string, now: Date): Promise<void>;
  list(tenantId: string, branchIds: readonly string[] | null): Promise<VoucherRow[]>;
  // Cola vencida, en el orden en que se emitió dentro de cada punto de venta (RF-102).
  due(tenantId: string, now: Date): Promise<Voucher[]>;
  // Toma un comprobante para enviarlo: otro worker no lo repite mientras dure el envío.
  claim(tenantId: string, id: string, now: Date, until: Date): Promise<boolean>;
  save(voucher: Voucher): Promise<void>;
  // La serie es por punto de venta y por tipo: A, B, C o NCA, NCB, NCC.
  nextNumber(tenantId: string, pointOfSale: number, series: string): Promise<number>;
  addAttempt(
    tenantId: string,
    attempt: {
      id: string;
      voucherId: string;
      at: Date;
      result: 'aceptado' | 'rechazado' | 'no_disponible';
      detail: string | null;
    },
  ): Promise<void>;
  overdue(tenantId: string, now: Date): Promise<Voucher[]>;
  pendingCounts(
    tenantId: string,
  ): Promise<{ queued: number; rejected: number; caeaNotReported: number }>;
  credentialInfo(
    tenantId: string,
  ): Promise<{ cuit: string; condition: IssuerCondition; expiresAt: Date } | undefined>;
  saveCredential(
    tenantId: string,
    credential: {
      cuit: string;
      condition: IssuerCondition;
      certificate: string;
      key: string;
      expiresAt: Date;
    },
    by: string,
    at: Date,
  ): Promise<void>;
  caeaFor(tenantId: string, date: string): Promise<string | undefined>;
  hasCaea(tenantId: string, period: string): Promise<boolean>;
  addCaea(
    tenantId: string,
    caea: { id: string; period: string; code: string; from: string; to: string; at: Date },
  ): Promise<void>;
}

export interface FiscalDirectory {
  tenantsWithModule(): Promise<string[]>;
  moduleActive(tenantId: string): Promise<boolean>;
  timeZone(tenantId: string): Promise<string>;
  settings(tenantId: string): Promise<{ regularizationHours: number; laterInvoicingDays: number }>;
}

export interface SaleForVoucher {
  id: string;
  branchId: string;
  registerId: string;
  total: string;
  state: string;
  billed: boolean | null;
  journeyDate: string;
  buyer: Buyer;
  pointOfSale: number | null;
}

// Lectura de la venta para armar su comprobante.
export interface FiscalSales {
  find(tenantId: string, saleId: string): Promise<SaleForVoucher | undefined>;
  findByTicket(tenantId: string, ticket: number): Promise<SaleForVoucher | undefined>;
}

export type SaleFiscalState = 'pendiente' | 'en_contingencia' | 'emitida' | 'rechazada';

// Lo implementa ventas: el estado fiscal es parte de la venta (RF-153).
export interface SaleFiscalStates {
  set(tenantId: string, saleId: string, state: SaleFiscalState): Promise<void>;
  markBilled(tenantId: string, saleId: string, by: string): Promise<void>;
}

export type FiscalAlertType =
  | 'comprobante_rechazado'
  | 'fiscal_sin_caea'
  | 'fiscal_sin_configurar'
  | 'caea_no_obtenido'
  | 'certificado_por_vencer'
  | 'fiscal_plazo_vencido';

export interface FiscalAlert {
  id: string;
  type: string;
  severity: string;
  branchId: string | null;
  recipientRole: string;
  reference: string | null;
  detail: Record<string, unknown>;
  createdAt: Date;
}

export interface FiscalAlerts {
  // No duplica una alerta sin resolver del mismo tipo, destinatario y referencia.
  raise(input: {
    tenantId: string;
    branchId: string | null;
    role: 'AS' | 'AC';
    type: FiscalAlertType;
    severity: 'advertencia' | 'critica';
    persistent: boolean;
    reference: string | null;
    detail: Record<string, unknown>;
    at: Date;
    nextReminder?: Date;
  }): Promise<void>;
  resolve(
    tenantId: string,
    type: FiscalAlertType,
    reference: string | null,
    at: Date,
  ): Promise<void>;
  // Suma un recordatorio a las alertas persistentes vencidas (RF-105).
  remind(tenantId: string, type: FiscalAlertType, now: Date, next: Date): Promise<number>;
  list(tenantId: string, branchIds: readonly string[] | null): Promise<FiscalAlert[]>;
}

export type FiscalResult =
  | { outcome: 'aceptado'; cae: string }
  | { outcome: 'rechazado'; reason: string }
  | { outcome: 'no_disponible' };

export interface VoucherRequest {
  tenantId: string;
  voucher: Voucher;
  cuit: string;
}

// Puerto ServicioFiscal: el adaptador clasifica cada respuesta (D-41).
export interface FiscalService {
  // Pide el CAE en línea.
  authorize(request: VoucherRequest): Promise<FiscalResult>;
  // Informa un comprobante ya emitido con CAEA.
  report(request: VoucherRequest): Promise<FiscalResult>;
  requestCaea(
    tenantId: string,
    period: string,
  ): Promise<{ outcome: 'aceptado'; code: string } | { outcome: 'no_disponible' }>;
}

export interface SecretCipher {
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
}

export type SimulatorFiscalMode = 'acepta' | 'rechaza' | 'caido';
