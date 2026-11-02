// Auditoría técnica y panel técnico del SA (T-056, T-057; RF-016, RF-022).
// Nunca incluyen contenido comercial.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type {
  PlatformHealth,
  PlatformHealthQuery,
  TechnicalAuditEntryView,
  TechnicalAuditFilter,
  TechnicalAuditQuery,
} from './ports.js';

export const MAX_AUDIT_ENTRIES = 200;

export class QueryTechnicalAudit {
  constructor(
    private readonly audit: TechnicalAuditQuery,
    private readonly access: AccessControl,
  ) {}

  async execute(
    context: SecurityContext,
    filter: Partial<TechnicalAuditFilter>,
  ): Promise<TechnicalAuditEntryView[]> {
    await this.access.check(context, 'plataforma.auditoria_tecnica.consultar');
    return this.audit.search({
      ...filter,
      limit: Math.min(Math.max(filter.limit ?? 50, 1), MAX_AUDIT_ENTRIES),
    });
  }
}

export class GetTechnicalPanel {
  constructor(
    private readonly health: PlatformHealthQuery,
    private readonly access: AccessControl,
  ) {}

  async execute(context: SecurityContext): Promise<PlatformHealth> {
    await this.access.check(context, 'plataforma.auditoria_tecnica.consultar');
    return this.health.snapshot();
  }
}
