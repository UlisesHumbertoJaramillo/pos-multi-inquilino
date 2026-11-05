// Puertos del módulo de ventas (plan §2.10).
import type { Promotion } from '../../promociones/aplicacion/promotions.js';
import type {
  BillingPolicy,
  CommercialState,
  DiscardReason,
  ManualDiscountInput,
} from '../dominio/sales.js';

export interface Actor {
  tenantId: string;
  userId: string;
  at: Date;
}

export interface Sale {
  id: string;
  tenantId: string;
  branchId: string;
  registerId: string;
  shiftId: string;
  sellerId: string;
  ticket: number | null;
  state: CommercialState;
  paymentState: 'pagada' | 'saldo_cuenta_corriente' | null;
  fiscalState: 'no_se_factura' | 'pendiente' | 'en_contingencia' | 'emitida' | 'rechazada' | null;
  billed: boolean | null;
  subtotal: string;
  promoDiscount: string;
  manualDiscount: string;
  total: string;
  discount: ManualDiscountInput | null;
  discountAuthorizationId: string | null;
  createdAt: Date;
  lastActivity: Date;
  confirmedAt: Date | null;
  discardReason: DiscardReason | null;
}

export interface SaleComponent {
  productId: string;
  name: string;
  quantity: string;
  listPrice: string;
  vatRate: string;
}

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  type: 'simple' | 'combo';
  name: string;
  categoryId: string | null;
  quantity: string;
  fixedPrice: string;
  vatRate: string | null;
  promotionId: string | null;
  promoDiscount: string;
  manualDiscount: string;
  final: string;
  components: SaleComponent[];
}

export interface Transfer {
  id: string;
  saleId: string;
  senderId: string;
  senderName: string;
  receiverId: string;
  receiverName: string;
  state: 'pendiente' | 'aceptado' | 'rechazado' | 'vencido';
  createdAt: Date;
  expiresAt: Date;
}

export interface Payment {
  id: string;
  saleId: string;
  methodId: string | null;
  type: 'efectivo';
  fraction: string;
  adjustment: string;
  tendered: string;
  change: string;
  at: Date;
}

export interface SalesRepository {
  insert(sale: Sale): Promise<void>;
  // Con bloqueo: serializa los cambios de una misma venta.
  find(tenantId: string, id: string, lock: boolean): Promise<Sale | undefined>;
  // Ventas en curso de un VO, con las que tienen un traspaso pendiente hacia él.
  inProgressOfSeller(tenantId: string, sellerId: string): Promise<Sale[]>;
  inProgressOfShift(tenantId: string, shiftId: string): Promise<Sale[]>;
  inProgressOfRegister(tenantId: string, registerId: string): Promise<Sale[]>;
  inProgressOfTenant(tenantId: string): Promise<Sale[]>;
  save(sale: Sale): Promise<void>;
  items(tenantId: string, saleId: string): Promise<SaleItem[]>;
  addItem(tenantId: string, item: SaleItem, at: Date): Promise<void>;
  saveItem(tenantId: string, item: SaleItem): Promise<void>;
  removeItem(tenantId: string, itemId: string, at: Date): Promise<void>;
  nextTicket(tenantId: string): Promise<number>;
  addPayment(tenantId: string, payment: Payment): Promise<void>;
  hasLivePayments(tenantId: string, saleId: string): Promise<boolean>;
  insertTransfer(tenantId: string, transfer: Transfer): Promise<void>;
  pendingTransfer(tenantId: string, saleId: string): Promise<Transfer | undefined>;
  findTransfer(tenantId: string, id: string, lock: boolean): Promise<Transfer | undefined>;
  pendingTransfersTo(tenantId: string, receiverId: string): Promise<Transfer[]>;
  resolveTransfer(
    tenantId: string,
    id: string,
    state: 'aceptado' | 'rechazado' | 'vencido',
    at: Date,
  ): Promise<void>;
}

export interface CatalogEntry {
  id: string;
  name: string;
  type: 'simple' | 'combo';
  barcode: string | null;
  categoryId: string | null;
  vatRate: string | null;
  // Precio final de la lista activa de la sucursal; el de un combo es único (D-63). Nulo: sin
  // precio en esa lista.
  price: string | null;
  isActive: boolean;
  components: SaleComponent[];
}

export interface SearchResult extends CatalogEntry {
  available: string;
}

export interface SalesCatalog {
  product(tenantId: string, branchId: string, productId: string): Promise<CatalogEntry | undefined>;
  search(tenantId: string, branchId: string, query: string): Promise<SearchResult[]>;
  available(tenantId: string, branchId: string, productId: string): Promise<string>;
  branchExists(tenantId: string, branchId: string): Promise<boolean>;
}

// Promociones del comercio, incluidas las vencidas o dadas de baja: una promoción fijada en un
// ítem se mantiene aunque venza (RF-143).
export interface SalePromotions {
  all(tenantId: string): Promise<Promotion[]>;
}

export interface SaleStock {
  apply(
    actor: Actor,
    change: {
      branchId: string;
      product: { id: string; name: string };
      operation: 'reservar' | 'liberar' | 'consumir';
      quantity: string;
      reference: string;
    },
  ): Promise<void>;
}

export interface OpenShift {
  id: string;
  registerId: string;
  branchId: string;
  journeyDate: string;
  sellerName: string;
}

export interface SaleShifts {
  openShiftOf(tenantId: string, sellerId: string): Promise<OpenShift | undefined>;
  // VO con turno abierto en la sucursal, para elegir a quién traspasar (RF-077).
  sellersWithOpenShift(tenantId: string, branchId: string): Promise<{ id: string; name: string }[]>;
}

export interface SaleCash {
  recordSale(
    actor: Actor,
    input: { shiftId: string; amount: string; methodId: string | null },
  ): Promise<void>;
}

export interface QuotaDiscount {
  subtotal: string;
  amount: string;
  enteredPercent: string | null;
}

export interface SaleQuota {
  // Controla el descuento contra la cuota sin consumirla.
  check(
    actor: Actor,
    input: { branchId: string; journeyDate: string; discount: QuotaDiscount },
  ): Promise<{ withinQuota: boolean; reasons: string[] }>;
  // Descuenta el saldo; si no alcanza, rechaza (lo autorizado no pasa por acá).
  consume(
    actor: Actor,
    input: { branchId: string; journeyDate: string; discount: QuotaDiscount },
  ): Promise<void>;
}

export interface SaleAuthorizations {
  consume(input: {
    id: string;
    type: 'descuento';
    operationRef: string;
    requesterId: string;
  }): Promise<void>;
}

export interface SaleSettings {
  cartIdleMinutes(tenantId: string): Promise<number>;
  billing(tenantId: string): Promise<{ module: boolean; policy: BillingPolicy }>;
  // Método de pago en efectivo activo del comercio, con su recargo o descuento.
  cashMethod(tenantId: string): Promise<{ id: string; adjustmentPct: string } | undefined>;
}
