// Arma el módulo fiscal con sus adaptadores. Lo usan la raíz de composición, el worker y las pruebas.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { EventHandler } from '../../../compartido/aplicacion/event-outbox.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { PgEventOutbox } from '../../../compartido/adaptadores/outbox/pg-event-outbox.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import {
  type FiscalDependencies,
  FiscalQueue,
  GetFiscalConfiguration,
  InvoiceLater,
  ListVouchers,
  ResendVoucher,
  SaveFiscalCredential,
} from '../aplicacion/fiscal.js';
import type { SaleFiscalStates } from '../aplicacion/ports.js';
import { FiscalSimulator, unavailableFiscalService } from './fiscal-simulator.js';
import { fiscalRoutes, fiscalSimulatorRoutes, type FiscalUseCases } from './http.js';
import {
  PgFiscalAlerts,
  PgFiscalDirectory,
  PgFiscalRepository,
  PgFiscalSales,
} from './postgres.js';
import { AesSecretCipher, certificateExpiry } from './secret-cipher.js';

export interface FiscalModuleDependencies {
  db: PgDatabase;
  clock: Clock;
  ids: IdGenerator;
  access: AccessControl;
  commercialAudit: CommercialAuditLog;
  production: boolean;
  masterKey: Buffer;
  defaults: { regularizationHours: number; laterInvoicingDays: number };
  states: SaleFiscalStates;
}

export interface FiscalModule {
  routes: HttpRoute[];
  useCases: FiscalUseCases;
  queue: FiscalQueue;
  eventHandlers: Record<string, EventHandler>;
}

export function createFiscalModule(deps: FiscalModuleDependencies): FiscalModule {
  const simulator = deps.production ? null : new FiscalSimulator(deps.db);
  const dependencies: FiscalDependencies = {
    uow: deps.db,
    vouchers: new PgFiscalRepository(deps.db),
    directory: new PgFiscalDirectory(deps.db, deps.defaults),
    sales: new PgFiscalSales(deps.db),
    states: deps.states,
    service: simulator ?? unavailableFiscalService,
    alerts: new PgFiscalAlerts(deps.db),
    cipher: new AesSecretCipher(deps.masterKey),
    certificateExpiry,
    outbox: new PgEventOutbox(deps.db, deps.clock, deps.ids),
    access: deps.access,
    audit: deps.commercialAudit,
    clock: deps.clock,
    ids: deps.ids,
  };
  const queue = new FiscalQueue(dependencies);
  const useCases: FiscalUseCases = {
    getConfiguration: new GetFiscalConfiguration(dependencies, queue),
    saveCredential: new SaveFiscalCredential(dependencies, queue),
    listVouchers: new ListVouchers(dependencies, queue),
    resendVoucher: new ResendVoucher(dependencies, queue),
    invoiceLater: new InvoiceLater(dependencies, queue),
  };
  return {
    routes: [
      ...fiscalRoutes(useCases),
      ...(simulator ? fiscalSimulatorRoutes(simulator, deps.access) : []),
    ],
    useCases,
    queue,
    eventHandlers: {
      // Nota de Crédito de una devolución o anulación (RF-087, RF-139). Idempotente.
      'nota_credito.solicitada': async (event) => {
        const { ventaId, origenId, total } = event.payload;
        if (
          event.tenantId !== null &&
          typeof ventaId === 'string' &&
          typeof origenId === 'string' &&
          typeof total === 'string'
        ) {
          await queue.requestCreditNote(event.tenantId, {
            saleId: ventaId,
            originId: origenId,
            total,
          });
        }
      },
      // Pedido de comprobante registrado al confirmar la venta (D-21). Idempotente.
      'comprobante.solicitado': async (event) => {
        const saleId = event.payload.ventaId;
        if (event.tenantId !== null && typeof saleId === 'string') {
          await queue.request(event.tenantId, saleId);
        }
      },
    },
  };
}
