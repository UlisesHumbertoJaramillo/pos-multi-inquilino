// Arma el módulo de ventas con sus adaptadores. Lo usan la raíz de composición, el worker y las
// pruebas.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { EventHandler } from '../../../compartido/aplicacion/event-outbox.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { JobHandler } from '../../../compartido/aplicacion/job-scheduler.js';
import { PgJobScheduler } from '../../../compartido/adaptadores/jobs/pg-job-scheduler.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { PgEventOutbox } from '../../../compartido/adaptadores/outbox/pg-event-outbox.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type { PaymentGateway, RefundAlerts } from '../../cobros/aplicacion/gateway.js';
import type { BillingPolicy } from '../dominio/sales.js';
import {
  ChargeElectronic,
  ConfirmSale,
  GetBillingOption,
  ListPaymentMethods,
  PAYMENT_VERIFICATION_JOB,
  PaymentVerification,
  ResolvePayment,
  ReversePayment,
  SearchCustomers,
  SetSaleCustomer,
} from '../aplicacion/payments.js';
import type {
  SaleAuthorizations,
  SaleCash,
  SaleCustomers,
  SalePromotions,
  SaleQuota,
  SaleShifts,
  SaleStock,
} from '../aplicacion/ports.js';
import {
  AcceptTransfer,
  AddItem,
  CART_EXPIRATION_JOB,
  DiscardSale,
  GetSale,
  ListOwnSales,
  ListTransferTargets,
  RejectTransfer,
  RemoveItem,
  SalesMaintenance,
  type SalesDependencies,
  SearchProducts,
  SendTransfer,
  SetManualDiscount,
  StartSale,
  TRANSFER_EXPIRATION_JOB,
  UpdateItemQuantity,
} from '../aplicacion/sales.js';
import { salesRoutes, type SalesUseCases } from './http.js';
import { PgSaleSettings, PgSalesCatalog, PgSalesRepository } from './postgres.js';

export interface SalesModuleDependencies {
  db: PgDatabase;
  clock: Clock;
  ids: IdGenerator;
  access: AccessControl;
  commercialAudit: CommercialAuditLog;
  defaults: { cartIdleMinutes: number; billingPolicy: BillingPolicy };
  promotions: SalePromotions;
  stock: SaleStock;
  shifts: SaleShifts;
  cash: SaleCash;
  quota: SaleQuota;
  authorizations: SaleAuthorizations;
  customers: SaleCustomers;
  gateway: PaymentGateway;
  alerts: RefundAlerts;
}

export interface SalesModule {
  routes: HttpRoute[];
  useCases: SalesUseCases;
  // Vencimientos, suspensión y ventas en curso para caja y cierre de sesión.
  maintenance: SalesMaintenance;
  verification: PaymentVerification;
  // Para organización: ventas en curso que impiden bajas (D-42).
  inProgress: PgSalesRepository['countInProgress'];
  jobHandlers: Record<string, JobHandler>;
  eventHandlers: Record<string, EventHandler>;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

export function createSalesModule(deps: SalesModuleDependencies): SalesModule {
  const sales = new PgSalesRepository(deps.db);
  const dependencies: SalesDependencies = {
    uow: deps.db,
    sales,
    catalog: new PgSalesCatalog(deps.db),
    promotions: deps.promotions,
    stock: deps.stock,
    shifts: deps.shifts,
    cash: deps.cash,
    quota: deps.quota,
    authorizations: deps.authorizations,
    customers: deps.customers,
    gateway: deps.gateway,
    alerts: deps.alerts,
    settings: new PgSaleSettings(deps.db, deps.defaults),
    jobs: new PgJobScheduler(deps.db, deps.clock, deps.ids),
    outbox: new PgEventOutbox(deps.db, deps.clock, deps.ids),
    access: deps.access,
    audit: deps.commercialAudit,
    clock: deps.clock,
    ids: deps.ids,
  };
  const useCases: SalesUseCases = {
    startSale: new StartSale(dependencies),
    listOwnSales: new ListOwnSales(dependencies),
    getSale: new GetSale(dependencies),
    searchProducts: new SearchProducts(dependencies),
    addItem: new AddItem(dependencies),
    updateItemQuantity: new UpdateItemQuantity(dependencies),
    removeItem: new RemoveItem(dependencies),
    setManualDiscount: new SetManualDiscount(dependencies),
    discardSale: new DiscardSale(dependencies),
    confirmSale: new ConfirmSale(dependencies),
    chargeElectronic: new ChargeElectronic(dependencies),
    reversePayment: new ReversePayment(dependencies),
    resolvePayment: new ResolvePayment(dependencies),
    setSaleCustomer: new SetSaleCustomer(dependencies),
    searchCustomers: new SearchCustomers(dependencies),
    listPaymentMethods: new ListPaymentMethods(dependencies),
    getBillingOption: new GetBillingOption(dependencies),
    listTransferTargets: new ListTransferTargets(dependencies),
    sendTransfer: new SendTransfer(dependencies),
    acceptTransfer: new AcceptTransfer(dependencies),
    rejectTransfer: new RejectTransfer(dependencies),
  };
  const maintenance = new SalesMaintenance(dependencies);
  const verification = new PaymentVerification(dependencies);
  return {
    routes: salesRoutes(useCases),
    useCases,
    maintenance,
    verification,
    inProgress: (tenantId, filter) =>
      deps.db.run(() => sales.countInProgress(tenantId, filter), { tenantId }),
    jobHandlers: {
      [CART_EXPIRATION_JOB]: (job) =>
        maintenance.expireCart(text(job.payload.tenantId), text(job.payload.saleId)),
      [TRANSFER_EXPIRATION_JOB]: (job) =>
        maintenance.expireTransfer(text(job.payload.tenantId), text(job.payload.transferId)),
      [PAYMENT_VERIFICATION_JOB]: (job) =>
        verification.verify(text(job.payload.tenantId), text(job.payload.paymentId)),
    },
    eventHandlers: {
      // Suspensión del comercio (RF-146, D-39): sus carritos se descartan y liberan sus reservas.
      // Es un evento de plataforma: el comercio viaja en el payload.
      'comercio.suspendido': async (event) => {
        const tenantId = text(event.payload.tenantId);
        if (tenantId !== '') await maintenance.discardForSuspension(tenantId);
      },
    },
  };
}
