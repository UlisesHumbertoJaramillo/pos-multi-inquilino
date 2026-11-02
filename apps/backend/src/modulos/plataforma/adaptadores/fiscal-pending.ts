// Adaptador provisorio del puerto ConsultaPendientesFiscales (T-053).
// Hasta la Fase 12 no existen comprobantes, así que ningún comercio tiene pendientes.
// En la Fase 12 se reemplaza por la consulta real a la tabla de comprobantes.
import { NO_FISCAL_PENDING } from '../dominio/tenant.js';
import type { FiscalPendingQuery } from '../aplicacion/ports.js';

export const noFiscalPendingYet: FiscalPendingQuery = {
  pendingFor: () => Promise.resolve({ ...NO_FISCAL_PENDING }),
};
