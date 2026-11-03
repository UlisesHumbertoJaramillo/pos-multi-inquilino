// Arma el módulo de promociones con sus adaptadores. Lo usan la raíz de composición y las pruebas.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { IdGenerator } from '../../../compartido/aplicacion/id-generator.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import {
  CreatePromotion,
  DeactivatePromotion,
  ListPromotions,
  type PromotionDependencies,
  type PromotionRepository,
  UpdatePromotion,
} from '../aplicacion/promotions.js';
import { promotionRoutes, type PromotionUseCases } from './http.js';
import { PgPromotionRepository, PgPromotionTargets } from './postgres.js';

export interface PromotionModuleDependencies {
  db: PgDatabase;
  clock: Clock;
  ids: IdGenerator;
  access: AccessControl;
  commercialAudit: CommercialAuditLog;
}

export interface PromotionModule {
  routes: HttpRoute[];
  useCases: PromotionUseCases;
  // Para ventas: las promociones del comercio, que se filtran por vigencia y sucursal.
  promotions: PromotionRepository;
}

export function createPromotionModule(deps: PromotionModuleDependencies): PromotionModule {
  const promotions = new PgPromotionRepository(deps.db);
  const dependencies: PromotionDependencies = {
    uow: deps.db,
    promotions,
    targets: new PgPromotionTargets(deps.db),
    access: deps.access,
    audit: deps.commercialAudit,
    clock: deps.clock,
    ids: deps.ids,
  };
  const useCases: PromotionUseCases = {
    listPromotions: new ListPromotions(dependencies),
    createPromotion: new CreatePromotion(dependencies),
    updatePromotion: new UpdatePromotion(dependencies),
    deactivatePromotion: new DeactivatePromotion(dependencies),
  };
  return { routes: promotionRoutes(useCases), useCases, promotions };
}
