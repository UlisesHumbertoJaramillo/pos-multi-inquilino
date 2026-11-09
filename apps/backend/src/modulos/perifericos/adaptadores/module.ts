// Módulo de periféricos: ruta del POS para informar el estado de la impresora y del lector, y su
// historial en la auditoría técnica (T-241). El contrato está en packages/contracts/openapi.yaml.
import { z } from 'zod';
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { TechnicalAuditLog } from '../../../compartido/aplicacion/audit.js';
import { securityContextOf } from '../../../compartido/adaptadores/http/authentication.js';
import type { HttpRoute } from '../../../compartido/adaptadores/http/routes.js';
import { parseInput } from '../../../compartido/adaptadores/http/validation.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import {
  PERIPHERAL_EVENT,
  type PeripheralHistory,
  ReportPeripheral,
} from '../aplicacion/peripherals.js';
import {
  CONNECTIONS,
  DEVICES,
  type Device,
  FAILURE_REASONS,
  type FailureReason,
  type PeripheralState,
  STATES,
} from '../dominio/peripherals.js';

// Lee el último evento de ese periférico en la auditoría técnica (tabla de plataforma).
export class PgPeripheralHistory implements PeripheralHistory {
  constructor(private readonly db: PgDatabase) {}

  async latest(tenantId: string, userId: string, device: Device) {
    const result = await this.db.query<{
      detalle: { estado?: PeripheralState; motivo?: FailureReason | null };
    }>(
      `SELECT detalle FROM auditoria_tecnica
        WHERE tipo_evento = $1 AND tenant_id = $2 AND actor_id = $3
          AND detalle->>'dispositivo' = $4
        ORDER BY momento DESC LIMIT 1`,
      [PERIPHERAL_EVENT, tenantId, userId, device],
    );
    const detail = result.rows[0]?.detalle;
    if (detail?.estado === undefined) return null;
    return { state: detail.estado, reason: detail.motivo ?? null };
  }
}

const reportBody = z
  .object({
    dispositivo: z.enum(DEVICES),
    conexion: z.enum(CONNECTIONS),
    estado: z.enum(STATES),
    motivo: z.enum(FAILURE_REASONS).nullable().optional(),
  })
  .strict();

export interface PeripheralsModule {
  routes: HttpRoute[];
  reportPeripheral: ReportPeripheral;
}

export function createPeripheralsModule(deps: {
  db: PgDatabase;
  access: AccessControl;
  technicalAudit: TechnicalAuditLog;
}): PeripheralsModule {
  const reportPeripheral = new ReportPeripheral({
    history: new PgPeripheralHistory(deps.db),
    technicalAudit: deps.technicalAudit,
    access: deps.access,
  });
  const routes: HttpRoute[] = [
    {
      method: 'post',
      path: '/perifericos/estado',
      action: 'ventas.operar',
      handler: async (req, res) => {
        const body = parseInput(reportBody, req.body);
        const recorded = await reportPeripheral.execute(securityContextOf(res), {
          device: body.dispositivo,
          connection: body.conexion,
          state: body.estado,
          reason: body.motivo ?? null,
        });
        res.json({ registrado: recorded });
      },
    },
  ];
  return { routes, reportPeripheral };
}
