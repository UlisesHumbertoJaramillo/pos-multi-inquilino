// Puertos del módulo de reportes (plan §2.18). Son consultas de solo lectura que siempre filtran
// por comercio y, si corresponde, por sucursal. No escriben.
import type { Period } from '../dominio/reports.js';

export interface TicketDocument {
  saleId: string;
  branchId: string;
  state: string;
  ticketNumber: number | null;
  confirmedAt: Date | null;
  tenant: { name: string; cuit: string | null; currency: string; timeZone: string };
  branch: { name: string; address: string | null };
  register: string;
  seller: string;
  customer: { name: string; document: string | null; taxCondition: string } | null;
  items: {
    name: string;
    quantity: string;
    unitPrice: string;
    gross: string;
    promotion: { name: string; discount: string } | null;
    manualDiscount: string;
    final: string;
    returned: string;
  }[];
  payments: {
    method: string;
    type: string;
    amount: string;
    surcharge: string;
    tendered: string;
    change: string;
  }[];
  totals: {
    subtotal: string;
    promotionDiscount: string;
    manualDiscount: string;
    total: string;
    surcharges: string;
    charged: string;
  };
  billed: boolean;
  voucher: {
    type: string;
    voucherClass: string | null;
    pointOfSale: number | null;
    number: string | null;
    cae: string | null;
    caea: string | null;
    state: string;
    nonFiscal: boolean;
  } | null;
}

export interface SalesTotals {
  total: string;
  tickets: number;
}

export interface MethodTotal {
  method: string;
  type: string;
  amount: string;
  surcharge: string;
}

export interface SellerTotal {
  sellerId: string;
  seller: string;
  tickets: number;
  total: string;
}

export interface ReturnTotals {
  count: number;
  value: string;
  refund: string;
}

export interface VoidTotals {
  count: number;
  total: string;
  refund: string;
}

export interface CashCountDifference {
  kind: 'turno' | 'jornada';
  register: string;
  seller: string | null;
  day: string;
  result: 'faltante' | 'sobrante';
  difference: string;
  at: Date;
}

export interface ShiftTotal {
  shiftId: string;
  register: string;
  seller: string;
  openedAt: Date;
  closedAt: Date | null;
  tickets: number;
  total: string;
  result: string | null;
  difference: string | null;
}

export interface ProductTotal {
  productId: string;
  name: string;
  quantity: string;
  total: string;
}

export interface DayTotal {
  day: string;
  total: string;
  tickets: number;
}

export interface BelowMinimum {
  branch: string;
  product: string;
  available: string;
  minimum: string;
}

export interface AlertCounts {
  critical: number;
  warning: number;
  info: number;
}

// Sucursales del filtro: nulo es todo el comercio.
export interface ReportScope {
  tenantId: string;
  branchIds: readonly string[] | null;
}

export interface ReportReader {
  timeZone(tenantId: string): Promise<string>;
  fiscalModule(tenantId: string): Promise<boolean>;
  branchName(tenantId: string, branchId: string): Promise<string | null>;
  ticket(tenantId: string, saleId: string): Promise<TicketDocument | undefined>;
  sales(scope: ReportScope, period: Period): Promise<SalesTotals>;
  byMethod(scope: ReportScope, period: Period): Promise<MethodTotal[]>;
  bySeller(scope: ReportScope, period: Period): Promise<SellerTotal[]>;
  byShift(scope: ReportScope, period: Period): Promise<ShiftTotal[]>;
  byProduct(scope: ReportScope, period: Period, limit: number): Promise<ProductTotal[]>;
  byDay(scope: ReportScope, period: Period): Promise<DayTotal[]>;
  returns(scope: ReportScope, period: Period): Promise<ReturnTotals>;
  voids(scope: ReportScope, period: Period): Promise<VoidTotals>;
  cashCounts(scope: ReportScope, period: Period): Promise<CashCountDifference[]>;
  // Comprobantes sin regularizar de las ventas del período (D-50).
  pendingVouchers(scope: ReportScope, period: Period | null): Promise<number>;
  belowMinimum(scope: ReportScope): Promise<BelowMinimum[]>;
  alertCounts(scope: ReportScope, role: 'AC' | 'AS'): Promise<AlertCounts>;
}

export interface AuditQuery {
  tenantId: string;
  // Nulo: todo el comercio, incluidas las acciones sin sucursal (AC).
  branchIds: readonly string[] | null;
  from: Date;
  to: Date;
  userId: string | null;
  entity: string | null;
  action: string | null;
  limit: number;
  offset: number;
}

export interface AuditEntry {
  id: string;
  at: Date;
  branchId: string | null;
  branch: string | null;
  userId: string;
  user: string | null;
  role: string;
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
  authorizationId: string | null;
}

export interface AuditReader {
  entries(query: AuditQuery): Promise<AuditEntry[]>;
}
