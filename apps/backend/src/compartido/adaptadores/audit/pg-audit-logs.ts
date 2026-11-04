// Adaptadores de auditoría sobre PostgreSQL (T-040, T-041, AD-10).
import type {
  CommercialAuditEntry,
  CommercialAuditLog,
  TechnicalAuditEntry,
  TechnicalAuditLog,
} from '../../aplicacion/audit.js';
import type { ResourceOwnership } from '../../aplicacion/access-control.js';
import type { Clock } from '../../aplicacion/clock.js';
import type { IdGenerator } from '../../aplicacion/id-generator.js';
import { redactSensitive } from '../logging/redact.js';
import type { PgDatabase } from '../postgres/pg-database.js';

// Se escribe fuera de la transacción en curso: un acceso denegado queda registrado aunque la
// operación se revierta. El detalle pasa por el mismo ocultamiento que el log (Const. 17).
export class PgTechnicalAuditLog implements TechnicalAuditLog {
  constructor(
    private readonly db: PgDatabase,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async record(entry: TechnicalAuditEntry): Promise<void> {
    await this.db.queryOutsideTransaction(
      `INSERT INTO auditoria_tecnica (id, momento, tipo_evento, actor_id, tenant_id, ip, detalle)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        this.ids.next(),
        this.clock.now(),
        entry.type,
        entry.actorId ?? null,
        entry.tenantId ?? null,
        entry.ip ?? null,
        JSON.stringify(redactSensitive(entry.detail ?? {})),
      ],
    );
  }
}

// Se escribe en la misma transacción que la operación: se confirma o se revierte con ella.
export class PgCommercialAuditLog implements CommercialAuditLog {
  constructor(
    private readonly db: PgDatabase,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async record(entry: CommercialAuditEntry): Promise<void> {
    if (!this.db.inTransaction) {
      throw new Error('La auditoría comercial solo se escribe dentro de una unidad de trabajo.');
    }
    await this.db.query(
      `INSERT INTO auditoria_comercial
         (id, tenant_id, sucursal_id, usuario_id, rol_activo, momento, accion, entidad, entidad_id,
          estado_anterior, estado_posterior, autorizacion_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        this.ids.next(),
        entry.tenantId,
        entry.branchId ?? null,
        entry.userId,
        entry.activeRole,
        this.clock.now(),
        entry.action,
        entry.entity,
        entry.entityId,
        entry.before === undefined ? null : JSON.stringify(redactSensitive(entry.before)),
        entry.after === undefined ? null : JSON.stringify(redactSensitive(entry.after)),
        entry.authorizationId ?? null,
      ],
    );
  }
}

// Recursos aislados por comercio que se pueden consultar. El nombre de la tabla nunca sale
// de la solicitud: se elige de esta lista.
const OWNED_TABLES: Readonly<Record<string, string>> = {
  autorizacion: 'autorizacion',
  credencial_autorizacion: 'credencial_autorizacion',
  auditoria_comercial: 'auditoria_comercial',
  sucursal: 'sucursal',
  caja: 'caja',
  turno: 'turno',
  metodo_pago: 'metodo_pago',
  categoria: 'categoria',
  producto: 'producto',
  lista_precio: 'lista_precio',
  transferencia: 'transferencia',
  alerta: 'alerta',
  proveedor: 'proveedor',
  compra: 'compra',
  promocion: 'promocion',
};

export class PgResourceOwnership implements ResourceOwnership {
  constructor(private readonly db: PgDatabase) {}

  async tenantOf(resourceType: string, id: string): Promise<string | null> {
    // Los usuarios son de identidad, sin seguridad a nivel de fila: se consultan directamente.
    if (resourceType === 'usuario') {
      const user = await this.db.query<{ tenant_id: string | null }>(
        'SELECT tenant_id FROM usuario WHERE id = $1',
        [id],
      );
      return user.rows[0]?.tenant_id ?? null;
    }
    const table = OWNED_TABLES[resourceType];
    if (!table) throw new Error(`Tipo de recurso desconocido: ${resourceType}`);
    const result = await this.db.query<{ tenant: string | null }>(
      'SELECT comercio_de_registro($1::regclass, $2::uuid) AS tenant',
      [table, id],
    );
    return result.rows[0]?.tenant ?? null;
  }
}
