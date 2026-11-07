// Adaptadores PostgreSQL del módulo de alertas: la tabla común `alerta` y los avisos en vivo.
import pg from 'pg';
import type { Logger } from '../../../compartido/aplicacion/logger.js';
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import { REMINDER_INTERVAL_MS, type AlertRole, type AlertSeverity } from '../dominio/alerts.js';
import type {
  AlertInbox,
  AlertQuery,
  AlertView,
  BranchLookup,
  RealtimeFeed,
  RealtimeNotice,
} from '../aplicacion/ports.js';

interface AlertRow {
  id: string;
  sucursal_id: string | null;
  sucursal: string | null;
  destinatario_rol: AlertRole;
  destinatario_id: string | null;
  tipo: string;
  severidad: AlertSeverity;
  persistente: boolean;
  referencia: string | null;
  detalle: Record<string, unknown>;
  creada_en: Date;
  ultimo_recordatorio: Date | null;
  resuelta_en: Date | null;
}

const COLUMNS = `a.id, a.sucursal_id, s.nombre AS sucursal, a.destinatario_rol, a.destinatario_id,
  a.tipo, a.severidad, a.persistente, a.referencia, a.detalle, a.creada_en, a.ultimo_recordatorio,
  a.resuelta_en`;

const FROM = `FROM alerta a LEFT JOIN sucursal s ON s.id = a.sucursal_id AND s.tenant_id = a.tenant_id`;

const toView = (r: AlertRow): AlertView => ({
  id: r.id,
  branchId: r.sucursal_id,
  branchName: r.sucursal,
  recipientRole: r.destinatario_rol,
  recipientId: r.destinatario_id,
  type: r.tipo,
  severity: r.severidad,
  persistent: r.persistente,
  reference: r.referencia,
  detail: r.detalle,
  createdAt: r.creada_en,
  lastReminder: r.ultimo_recordatorio,
  resolvedAt: r.resuelta_en,
});

export class PgAlertInbox implements AlertInbox {
  constructor(private readonly db: PgDatabase) {}

  // Mismo criterio que isVisibleTo del dominio, en SQL para no traer alertas ajenas.
  async pending(q: AlertQuery): Promise<AlertView[]> {
    const result = await this.db.query<AlertRow>(
      `SELECT ${COLUMNS} ${FROM}
        WHERE a.tenant_id = $1 AND a.resuelta_en IS NULL AND a.destinatario_rol = $2
          AND (a.destinatario_id IS NULL OR a.destinatario_id = $3)
          AND (a.destinatario_id IS NOT NULL OR $4::uuid[] IS NULL OR a.sucursal_id = ANY($4::uuid[]))
          AND ($5::uuid IS NULL OR a.sucursal_id = $5)
        ORDER BY COALESCE(a.ultimo_recordatorio, a.creada_en) DESC, a.id
        LIMIT 200`,
      [q.tenantId, q.role, q.userId, q.branchIds, q.branchId],
    );
    return result.rows.map(toView);
  }

  async find(tenantId: string, id: string): Promise<AlertView | undefined> {
    const result = await this.db.query<AlertRow>(
      `SELECT ${COLUMNS} ${FROM} WHERE a.tenant_id = $1 AND a.id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    return row ? toView(row) : undefined;
  }

  async resolve(
    tenantId: string,
    id: string,
    by: string,
    at: Date,
    note: string | null,
  ): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE alerta SET resuelta_en = $3, resuelta_por = $4,
         detalle = CASE WHEN $5::text IS NULL THEN detalle
                        ELSE detalle || jsonb_build_object('resolucion', $5::text) END
        WHERE tenant_id = $1 AND id = $2 AND resuelta_en IS NULL`,
      [tenantId, id, at, by, note],
    );
    return result.rowCount === 1;
  }

  async activeTenants(): Promise<string[]> {
    const result = await this.db.query<{ id: string }>(
      `SELECT id FROM comercio WHERE estado = 'activo' ORDER BY id`,
    );
    return result.rows.map((r) => r.id);
  }

  // Sin recordatorio programado, el primero llega 24 horas después de creada.
  async remind(tenantId: string, now: Date, next: Date): Promise<number> {
    const result = await this.db.query(
      `UPDATE alerta SET proximo_recordatorio = $3, ultimo_recordatorio = $2,
         detalle = jsonb_set(detalle, '{recordatorios}',
           to_jsonb(COALESCE((detalle->>'recordatorios')::int, 0) + 1))
        WHERE tenant_id = $1 AND persistente AND resuelta_en IS NULL
          AND COALESCE(proximo_recordatorio, creada_en + $4::bigint * interval '1 millisecond') <= $2`,
      [tenantId, now, next, REMINDER_INTERVAL_MS],
    );
    return result.rowCount ?? 0;
  }
}

export class PgBranchLookup implements BranchLookup {
  constructor(private readonly db: PgDatabase) {}

  async exists(tenantId: string, branchId: string): Promise<boolean> {
    const result = await this.db.query(
      'SELECT 1 FROM sucursal WHERE tenant_id = $1 AND id = $2 AND is_active',
      [tenantId, branchId],
    );
    return result.rows.length > 0;
  }
}

export const REALTIME_CHANNEL = 'pos_tiempo_real';

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const ROLES: readonly string[] = ['AC', 'AS', 'VO'];

// Traduce el aviso de los disparadores de la migración. Lo que no reconoce, lo descarta.
export function parseNotice(payload: string | undefined): RealtimeNotice | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(payload ?? '') as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!isText(data.tenantId)) return null;
  if (data.tipo === 'stock') {
    if (!isText(data.sucursalId) || !isText(data.productoId) || !isText(data.disponible)) {
      return null;
    }
    return {
      kind: 'stock',
      tenantId: data.tenantId,
      branchId: data.sucursalId,
      productId: data.productoId,
      available: data.disponible,
    };
  }
  if (data.tipo === 'alertas' && isText(data.rol) && ROLES.includes(data.rol)) {
    return {
      kind: 'alertas',
      tenantId: data.tenantId,
      branchId: isText(data.sucursalId) ? data.sucursalId : null,
      role: data.rol as AlertRole,
    };
  }
  return null;
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

// Escucha el canal con una conexión dedicada (LISTEN no funciona sobre el pool). Si se corta, se
// reconecta con espera creciente; los clientes en vivo vuelven a pedir el estado al reconectar.
export class PgRealtimeFeed implements RealtimeFeed {
  private client: pg.Client | null = null;
  private stopped = false;
  private retryMs = RECONNECT_MIN_MS;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: pg.ClientConfig,
    private readonly logger: Logger,
  ) {}

  async start(onNotice: (notice: RealtimeNotice) => void): Promise<void> {
    this.stopped = false;
    await this.connect(onNotice);
  }

  private async connect(onNotice: (notice: RealtimeNotice) => void): Promise<void> {
    const client = new pg.Client(this.config);
    client.on('notification', (message) => {
      if (message.channel !== REALTIME_CHANNEL) return;
      const notice = parseNotice(message.payload);
      if (notice) onNotice(notice);
    });
    client.on('error', (error) => {
      this.logger.warn('Se perdió la conexión de los avisos en vivo', { err: error });
      this.scheduleReconnect(client, onNotice);
    });
    client.on('end', () => {
      this.scheduleReconnect(client, onNotice);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${REALTIME_CHANNEL}`);
      this.client = client;
      this.retryMs = RECONNECT_MIN_MS;
    } catch (error: unknown) {
      this.logger.warn('No se pudo escuchar los avisos en vivo, se reintentará', { err: error });
      this.scheduleReconnect(client, onNotice);
    }
  }

  private scheduleReconnect(client: pg.Client, onNotice: (notice: RealtimeNotice) => void) {
    if (this.stopped || this.timer !== null || (this.client !== null && this.client !== client)) {
      return;
    }
    this.client = null;
    client.removeAllListeners();
    client.on('error', () => undefined);
    void client.end().catch(() => undefined);
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, RECONNECT_MAX_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect(onNotice);
    }, delay);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners();
      client.on('error', () => undefined);
      await client.end().catch(() => undefined);
    }
  }
}
