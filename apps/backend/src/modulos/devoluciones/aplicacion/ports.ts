// Puertos del módulo de devoluciones (plan §2.13).
import type { PaymentType } from '../../cobros/aplicacion/gateway.js';

export interface Actor {
  tenantId: string;
  userId: string;
  at: Date;
}

export interface ReturnItem {
  id: string;
  productId: string;
  name: string;
  type: 'simple' | 'combo';
  quantity: string;
  returned: string;
  final: string;
  components: { productId: string; name: string; quantity: string }[];
}

export interface ReturnPayment {
  id: string;
  methodId: string | null;
  methodName: string;
  type: PaymentType;
  // Lo cobrado con este medio: fracción más su recargo o descuento.
  charged: string;
  key: string | null;
}

export interface ReturnSale {
  id: string;
  ticket: number | null;
  branchId: string;
  branchName: string;
  shiftId: string;
  state: string;
  total: string;
  billed: boolean | null;
  journeyDate: string;
  customerId: string | null;
  items: ReturnItem[];
  payments: ReturnPayment[];
  // Valor de la mercadería ya devuelta en devoluciones confirmadas.
  returnedValue: string;
  hasReturns: boolean;
}

export interface ReturnRecord {
  id: string;
  saleId: string;
  branchId: string;
  shiftId: string;
  sellerId: string;
  value: string;
  refund: string;
  authorizationId: string | null;
  at: Date;
  items: { id: string; saleItemId: string; productId: string; quantity: string; amount: string }[];
}

export interface RefundRecord {
  id: string;
  returnId: string | null;
  voidId: string | null;
  paymentId: string;
  type: PaymentType;
  amount: string;
  excess: string;
  key: string | null;
  at: Date;
}

export interface ReturnRepository {
  find(tenantId: string, saleId: string, lock: boolean): Promise<ReturnSale | undefined>;
  findByTicket(tenantId: string, ticket: number): Promise<ReturnSale | undefined>;
  insertReturn(tenantId: string, record: ReturnRecord): Promise<void>;
  resolveReturn(
    tenantId: string,
    id: string,
    state: 'confirmada' | 'rechazada',
    at: Date,
  ): Promise<void>;
  insertVoid(
    tenantId: string,
    record: {
      id: string;
      saleId: string;
      shiftId: string;
      requesterId: string;
      authorizationId: string;
      refund: string;
      at: Date;
    },
  ): Promise<void>;
  addRefund(tenantId: string, refund: RefundRecord): Promise<void>;
}

export interface ReturnSettings {
  returnWindowDays(tenantId: string): Promise<number>;
  timeZone(tenantId: string): Promise<string>;
  billingModule(tenantId: string): Promise<boolean>;
}

export interface ReturnShifts {
  openShiftOf(
    tenantId: string,
    sellerId: string,
  ): Promise<{ id: string; branchId: string } | undefined>;
  cashOnHand(tenantId: string, shiftId: string): Promise<string>;
  recordReturn(
    actor: Actor,
    input: {
      shiftId: string;
      amount: string;
      methodId: string | null;
      inCash: boolean;
      type: 'reintegro' | 'anulacion';
      authorizationId: string | null;
    },
  ): Promise<void>;
  refundRejected(
    actor: Actor,
    input: { shiftId: string; amount: string; authorizationId: string | null },
  ): Promise<void>;
}

export interface ReturnSalesState {
  addReturned(tenantId: string, itemId: string, quantity: string): Promise<boolean>;
  subtractReturned(tenantId: string, itemId: string, quantity: string): Promise<void>;
  markVoided(tenantId: string, saleId: string): Promise<void>;
}

export interface ReturnStock {
  apply(
    actor: Actor,
    change: {
      branchId: string;
      product: { id: string; name: string };
      operation: 'pasarARevision' | 'reponer';
      quantity: string;
      reference: string;
    },
  ): Promise<void>;
}

export interface ReturnCredit {
  refund(
    actor: Actor,
    input: { customerId: string; amount: string; saleId: string; type: 'devolucion' | 'anulacion' },
  ): Promise<{ reduced: string; excess: string }>;
}

export interface ReturnAuthorizations {
  consume(input: {
    id: string;
    type: 'anulacion' | 'reembolso';
    operationRef: string;
    requesterId: string;
  }): Promise<void>;
}

// Un reintegro electrónico que la pasarela no confirmó después de aplicarse: alerta al AS y al AC.
export interface UncertainRefunds {
  add(input: {
    tenantId: string;
    branchId: string;
    saleId: string;
    detail: Record<string, unknown>;
    at: Date;
  }): Promise<void>;
}
