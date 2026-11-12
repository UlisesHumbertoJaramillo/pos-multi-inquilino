// Atajos de teclado del POS de cada comercio (T-274; RF-185, AD-28). El VO los consulta para
// operar; solo el AC los cambia o vuelve a la distribución por defecto, y queda auditado.
import type { AccessControl } from '../../../compartido/aplicacion/access-control.js';
import type { CommercialAuditLog } from '../../../compartido/aplicacion/audit.js';
import type { Clock } from '../../../compartido/aplicacion/clock.js';
import type { Action } from '../../../compartido/aplicacion/permissions.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { UnitOfWork } from '../../../compartido/aplicacion/unit-of-work.js';
import { DEFAULT_SHORTCUTS, type ShortcutMap, validateShortcuts } from '../dominio/shortcuts.js';

// Mapa guardado del comercio. Nulo: rige la distribución por defecto.
export interface ShortcutRepository {
  find(tenantId: string): Promise<Partial<Record<string, string | null>> | null>;
  save(tenantId: string, map: ShortcutMap | null, by: string, at: Date): Promise<void>;
}

export interface ShortcutDependencies {
  uow: UnitOfWork;
  shortcuts: ShortcutRepository;
  access: AccessControl;
  audit: CommercialAuditLog;
  clock: Clock;
}

export interface ShortcutSettings {
  map: ShortcutMap;
  // Verdadero si el comercio usa la distribución por defecto.
  isDefault: boolean;
}

abstract class ShortcutUseCase {
  constructor(protected readonly deps: ShortcutDependencies) {}

  protected async inTenant<T>(
    context: SecurityContext,
    action: Action,
    work: (tenantId: string) => Promise<T>,
  ): Promise<T> {
    await this.deps.access.check(context, action);
    const tenantId = this.deps.access.requireTenant(context);
    return this.deps.uow.run(() => work(tenantId), { tenantId });
  }

  protected async current(tenantId: string): Promise<ShortcutSettings> {
    const saved = await this.deps.shortcuts.find(tenantId);
    // Un mapa guardado antes de sumar una acción la completa con su tecla por defecto.
    return saved === null
      ? { map: { ...DEFAULT_SHORTCUTS }, isDefault: true }
      : { map: validateShortcuts(saved), isDefault: false };
  }
}

// Los atajos con que opera el POS del comercio.
export class GetPosShortcuts extends ShortcutUseCase {
  execute(context: SecurityContext): Promise<ShortcutSettings> {
    return this.inTenant(context, 'ventas.operar', (tenantId) => this.current(tenantId));
  }
}

// Los atajos para la pantalla de configuración del AC.
export class GetShortcutSettings extends ShortcutUseCase {
  execute(context: SecurityContext): Promise<ShortcutSettings> {
    return this.inTenant(context, 'parametros.gestionar', (tenantId) => this.current(tenantId));
  }
}

export class UpdateShortcuts extends ShortcutUseCase {
  execute(
    context: SecurityContext,
    input: Partial<Record<string, string | null>>,
  ): Promise<ShortcutSettings> {
    return this.inTenant(context, 'parametros.gestionar', async (tenantId) => {
      const before = await this.current(tenantId);
      const map = validateShortcuts(input);
      await this.deps.shortcuts.save(tenantId, map, context.userId, this.deps.clock.now());
      await this.record(context, tenantId, before.map, map);
      return { map, isDefault: false };
    });
  }

  private async record(
    context: SecurityContext,
    tenantId: string,
    before: ShortcutMap,
    after: ShortcutMap,
  ) {
    await this.deps.audit.record({
      tenantId,
      userId: context.userId,
      activeRole: 'AC',
      action: 'atajos.cambiar',
      entity: 'atajos_comercio',
      entityId: tenantId,
      before,
      after,
    });
  }
}

export class ResetShortcuts extends ShortcutUseCase {
  execute(context: SecurityContext): Promise<ShortcutSettings> {
    return this.inTenant(context, 'parametros.gestionar', async (tenantId) => {
      const before = await this.current(tenantId);
      await this.deps.shortcuts.save(tenantId, null, context.userId, this.deps.clock.now());
      await this.deps.audit.record({
        tenantId,
        userId: context.userId,
        activeRole: 'AC',
        action: 'atajos.restablecer',
        entity: 'atajos_comercio',
        entityId: tenantId,
        before: before.map,
        after: DEFAULT_SHORTCUTS,
      });
      return { map: { ...DEFAULT_SHORTCUTS }, isDefault: true };
    });
  }
}
