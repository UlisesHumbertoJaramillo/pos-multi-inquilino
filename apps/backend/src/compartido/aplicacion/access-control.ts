// Control de acceso de los casos de uso (T-037, T-040, T-042, RF-002 a RF-004).
// Aplica la matriz de permisos y registra en la auditoría técnica cada acceso denegado.
// Un recurso de otro comercio se responde como inexistente y el intento queda registrado.
import type { TechnicalAuditLog } from './audit.js';
import { forbiddenError, notFoundError } from './errors.js';
import { decide, type Action, type ResourceScope } from './permissions.js';
import type { SecurityContext } from './security-context.js';

// Comercio dueño de un registro, aunque la sesión no pueda verlo. Nunca devuelve datos del registro.
export interface ResourceOwnership {
  tenantOf(resourceType: string, id: string): Promise<string | null>;
}

export class AccessControl {
  constructor(
    private readonly audit: TechnicalAuditLog,
    private readonly ownership: ResourceOwnership,
  ) {}

  async check(context: SecurityContext, action: Action, resource?: ResourceScope): Promise<void> {
    const decision = decide(context, action, resource);
    if (decision.allowed) return;

    if (decision.reason === 'other_tenant') {
      await this.recordForeignAccess(context, { action });
      throw notFoundError();
    }
    await this.audit.record({
      type: 'acceso_denegado',
      actorId: context.userId,
      tenantId: context.tenantId,
      detail: { action, reason: decision.reason, activeRole: context.activeRole },
    });
    throw forbiddenError();
  }

  // Para cuando un repositorio no encontró el recurso: si existe en otro comercio, se registra.
  // La respuesta es la misma en los dos casos.
  async notFound(context: SecurityContext, resourceType: string, id: string): Promise<never> {
    const owner = await this.ownership.tenantOf(resourceType, id);
    if (owner !== null && owner !== context.tenantId) {
      await this.recordForeignAccess(context, { resourceType, resourceId: id });
    }
    throw notFoundError();
  }

  // Comercio de la sesión. Una acción comercial sin comercio (por ejemplo, del SA) se rechaza.
  requireTenant(context: SecurityContext): string {
    if (context.tenantId === null) throw forbiddenError();
    return context.tenantId;
  }

  private async recordForeignAccess(
    context: SecurityContext,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      type: 'acceso_otro_comercio',
      actorId: context.userId,
      tenantId: context.tenantId,
      detail,
    });
  }
}
