// Arma el módulo de cuota de descuento con sus adaptadores. Lo usan la raíz de composición y las
// pruebas.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import {
  type DiscountAuthorizations,
  DiscountQuota,
  GetDiscountCap,
  ListSellerQuotas,
  type QuotaDependencies,
  SetDiscountCap,
  SetSellerQuota,
} from '../aplicacion/quotas.js';
import { quotaRoutes, type QuotaUseCases } from './http.js';
import { PgQuotaDirectory, PgQuotaRepository } from './postgres.js';

export interface QuotaModuleDependencies {
  db: PgDatabase;
  clock: Clock;
  ids: IdGenerator;
  access: AccessControl;
  commercialAudit: CommercialAuditLog;
  authorizations: DiscountAuthorizations;
}

export interface QuotaModule {
  routes: HttpRoute[];
  useCases: QuotaUseCases;
  // Para turnos y ventas: abrir el saldo del día y aplicar descuentos dentro de su transacción.
  discounts: DiscountQuota;
}

export function createQuotaModule(deps: QuotaModuleDependencies): QuotaModule {
  const dependencies: QuotaDependencies = {
    uow: deps.db,
    quotas: new PgQuotaRepository(deps.db),
    directory: new PgQuotaDirectory(deps.db),
    authorizations: deps.authorizations,
    access: deps.access,
    audit: deps.commercialAudit,
    clock: deps.clock,
    ids: deps.ids,
  };
  const useCases: QuotaUseCases = {
    getCap: new GetDiscountCap(dependencies),
    setCap: new SetDiscountCap(dependencies),
    listSellerQuotas: new ListSellerQuotas(dependencies),
    setSellerQuota: new SetSellerQuota(dependencies),
  };
  return {
    routes: quotaRoutes(useCases),
    useCases,
    discounts: new DiscountQuota(dependencies),
  };
}
