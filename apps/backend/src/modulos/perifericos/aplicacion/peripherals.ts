// Caso de uso: el POS informa el estado de un periférico (T-241; RF-016, AD-16). Queda en la
// auditoría técnica y el SA lo ve en el panel técnico.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { TechnicalAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import {
  type Device,
  type FailureReason,
  isChange,
  normalize,
  type PeripheralReport,
  type PeripheralState,
} from '../dominio/peripherals.js';

export const PERIPHERAL_EVENT = 'periferico';

export interface PeripheralHistory {
  // Último estado informado por ese usuario para ese periférico.
  latest(
    tenantId: string,
    userId: string,
    device: Device,
  ): Promise<{ state: PeripheralState; reason: FailureReason | null } | null>;
}

export interface PeripheralDependencies {
  history: PeripheralHistory;
  technicalAudit: TechnicalAuditLog;
  access: AccessControl;
}

export class ReportPeripheral {
  constructor(private readonly deps: PeripheralDependencies) {}

  // Devuelve si quedó registrado (solo los cambios de estado se registran).
  async execute(context: SecurityContext, input: PeripheralReport): Promise<boolean> {
    await this.deps.access.check(context, 'ventas.operar');
    const tenantId = this.deps.access.requireTenant(context);
    const report = normalize(input);
    const previous = await this.deps.history.latest(tenantId, context.userId, report.device);
    if (!isChange(previous, report)) return false;
    await this.deps.technicalAudit.record({
      type: PERIPHERAL_EVENT,
      actorId: context.userId,
      tenantId,
      detail: {
        dispositivo: report.device,
        conexion: report.connection,
        estado: report.state,
        motivo: report.reason,
      },
    });
    return true;
  }
}
