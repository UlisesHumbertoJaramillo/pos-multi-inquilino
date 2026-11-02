// Adaptadores provisorios y políticas que el módulo de organización ofrece a otros módulos.
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import { DEFAULT_PARAMETERS } from '../dominio/parameters.js';
import { NO_DEPENDENCIES } from '../dominio/structure.js';
import type { DependencyQuery } from '../aplicacion/ports.js';
import { PgParametersRepository } from './postgres.js';

// Puerto ConsultaDependencias (T-063) mientras no existen turnos, ventas ni transferencias.
// Se reemplaza en las Fases 9 y 10.
export const noDependenciesYet: DependencyQuery = {
  forBranch: () => Promise.resolve({ ...NO_DEPENDENCIES }),
  forRegister: () => Promise.resolve({ ...NO_DEPENDENCIES }),
  forUser: () => Promise.resolve({ ...NO_DEPENDENCIES }),
};

// Inactividad de sesión del comercio (RF-009, RF-135), para el módulo de identidad. Se lee en una
// transacción propia con el comercio fijado, porque la tabla está aislada por comercio.
export function tenantSessionIdlePolicy(db: PgDatabase) {
  const parameters = new PgParametersRepository(db);
  return {
    async idleMs(tenantId: string | null): Promise<number> {
      if (tenantId === null) return DEFAULT_PARAMETERS.sessionIdleMinutes * 60_000;
      const found = await db.runIndependent(() => parameters.find(tenantId), { tenantId });
      return (found ?? DEFAULT_PARAMETERS).sessionIdleMinutes * 60_000;
    },
  };
}
