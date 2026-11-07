// Puertos del módulo de cobros (plan §2.12).
import type { FiscalCondition } from '../dominio/customers.js';
import type { PaymentMethod } from './gateway.js';

export interface Actor {
  tenantId: string;
  userId: string;
  at: Date;
}

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  document: string | null;
  fiscalCondition: FiscalCondition;
  hasAccount: boolean;
  creditLimit: string;
  balance: string;
  committed: string;
  isActive: boolean;
}

export type CollectionState = 'pendiente' | 'por_verificar' | 'aplicado' | 'rechazado';

export interface Collection {
  id: string;
  tenantId: string;
  customerId: string;
  customerName: string;
  branchId: string;
  shiftId: string;
  sellerId: string;
  amount: string;
  state: CollectionState;
  createdAt: Date;
}

export interface CollectionPayment {
  id: string;
  collectionId: string;
  methodId: string;
  methodName: string;
  type: 'efectivo' | 'electronico';
  amount: string;
  adjustment: string;
  tendered: string;
  change: string;
  state: 'pendiente' | 'aprobado' | 'rechazado' | 'por_verificar';
  key: string | null;
  reference: string | null;
  checks: number;
  manuallyResolved: boolean;
  lateApprovedAt: Date | null;
  authorizationId: string | null;
  at: Date;
}

export interface ReceiptRecord {
  id: string;
  number: number;
  collectionId: string;
  customerId: string;
  shiftId: string;
  amount: string;
  issuedAt: Date;
}

export interface CustomerRepository {
  list(tenantId: string, includeInactive: boolean): Promise<Customer[]>;
  search(tenantId: string, query: string): Promise<Customer[]>;
  find(tenantId: string, id: string, lock: boolean): Promise<Customer | undefined>;
  // Rechaza con false si el documento ya lo tiene otro cliente activo.
  insert(customer: Customer, at: Date): Promise<boolean>;
  update(customer: Customer): Promise<boolean>;
  deactivate(tenantId: string, id: string, by: string, at: Date): Promise<void>;
  // Suma al saldo en una sola sentencia: dos ventas simultáneas nunca superan el límite (RF-152).
  // Devuelve el saldo nuevo, o null si excedería el límite y no se permite.
  increaseBalance(
    tenantId: string,
    id: string,
    amount: string,
    allowExcess: boolean,
  ): Promise<string | null>;
  // Baja la deuda sin tocar lo comprometido por otros cobros. Devuelve null si no alcanza.
  reduceBalance(tenantId: string, id: string, amount: string): Promise<string | null>;
  // Aparta parte de la deuda para un cobro electrónico sin resultado.
  commit(tenantId: string, id: string, amount: string): Promise<boolean>;
  release(tenantId: string, id: string, amount: string): Promise<void>;
  addMovement(
    actor: Actor,
    movement: {
      id: string;
      customerId: string;
      type: 'venta' | 'cobro' | 'devolucion' | 'anulacion';
      amount: string;
      balance: string;
      saleId: string | null;
      collectionId: string | null;
    },
  ): Promise<void>;
}

export interface CollectionRepository {
  insert(collection: Collection): Promise<void>;
  find(tenantId: string, id: string, lock: boolean): Promise<Collection | undefined>;
  setState(tenantId: string, id: string, state: CollectionState, at: Date): Promise<void>;
  pendingOfSeller(tenantId: string, sellerId: string): Promise<Collection[]>;
  pendingOfShift(tenantId: string, shiftId: string): Promise<Collection[]>;
  addPayment(tenantId: string, payment: CollectionPayment): Promise<void>;
  paymentOf(tenantId: string, collectionId: string): Promise<CollectionPayment | undefined>;
  paymentByKey(tenantId: string, key: string): Promise<CollectionPayment | undefined>;
  paymentById(tenantId: string, id: string): Promise<CollectionPayment | undefined>;
  savePayment(tenantId: string, payment: CollectionPayment): Promise<void>;
  addReceipt(tenantId: string, receipt: Omit<ReceiptRecord, 'number'>): Promise<ReceiptRecord>;
  receiptOf(tenantId: string, collectionId: string): Promise<ReceiptRecord | undefined>;
}

export interface CollectionMethods {
  active(tenantId: string): Promise<PaymentMethod[]>;
}

export interface CollectionShifts {
  openShiftOf(
    tenantId: string,
    sellerId: string,
  ): Promise<{ id: string; branchId: string } | undefined>;
  recordCollection(
    actor: Actor,
    input: { shiftId: string; amount: string; methodId: string; inCash: boolean },
  ): Promise<void>;
}

export interface CollectionAuthorizations {
  consume(input: {
    id: string;
    type: 'pago_por_verificar';
    operationRef: string;
    requesterId: string;
  }): Promise<void>;
}

export type SimulatorMode = 'aprobar' | 'rechazar' | 'no_responder' | 'aprobar_tarde';
