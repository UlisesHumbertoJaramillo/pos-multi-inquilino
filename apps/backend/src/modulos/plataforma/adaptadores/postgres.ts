// Repositorios y consultas PostgreSQL del módulo de plataforma. Son tablas de plataforma, sin
// seguridad a nivel de fila: el SA las recorre para todos los comercios.
import type { PgDatabase } from '../../../compartido/adaptadores/postgres/pg-database.js';
import type { Tenant, TenantStatus } from '../dominio/tenant.js';
import type {
  PlatformHealth,
  PlatformHealthQuery,
  TechnicalAuditEntryView,
  TechnicalAuditFilter,
  TechnicalAuditQuery,
  Ticket,
  TicketMessage,
  TicketRepository,
  TicketStatus,
  TenantRepository,
} from '../aplicacion/ports.js';

interface TenantRow {
  id: string;
  nombre: string;
  cuit: string | null;
  moneda: string;
  zona_horaria: string;
  estado: TenantStatus;
  tiene_operaciones: boolean;
  modulo_facturacion: boolean;
  creado_en: Date;
}

const TENANT_COLUMNS =
  'id, nombre, cuit, moneda, zona_horaria, estado, tiene_operaciones, modulo_facturacion, creado_en';

function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.nombre,
    cuit: row.cuit,
    currency: row.moneda,
    timezone: row.zona_horaria,
    status: row.estado,
    hasOperations: row.tiene_operaciones,
    billingModule: row.modulo_facturacion,
    createdAt: row.creado_en,
  };
}

export class PgTenantRepository implements TenantRepository {
  constructor(private readonly db: PgDatabase) {}

  async insert(t: Tenant): Promise<void> {
    await this.db.query(
      `INSERT INTO comercio (id, nombre, cuit, moneda, zona_horaria, estado, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [t.id, t.name, t.cuit, t.currency, t.timezone, t.status, t.createdAt],
    );
  }

  async findById(id: string): Promise<Tenant | undefined> {
    const result = await this.db.query<TenantRow>(
      `SELECT ${TENANT_COLUMNS} FROM comercio WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? toTenant(row) : undefined;
  }

  async list(): Promise<Tenant[]> {
    const result = await this.db.query<TenantRow>(
      `SELECT ${TENANT_COLUMNS} FROM comercio ORDER BY nombre`,
    );
    return result.rows.map(toTenant);
  }

  async save(t: Tenant, by: string, at: Date): Promise<void> {
    await this.db.query(
      `UPDATE comercio
          SET nombre = $2, cuit = $3, moneda = $4, zona_horaria = $5, estado = $6,
              actualizado_en = $8,
              modulo_facturacion_cambiado_en =
                CASE WHEN modulo_facturacion <> $7 THEN $8 ELSE modulo_facturacion_cambiado_en END,
              modulo_facturacion_cambiado_por =
                CASE WHEN modulo_facturacion <> $7 THEN $9::uuid ELSE modulo_facturacion_cambiado_por END,
              modulo_facturacion = $7,
              dado_de_baja_en = CASE WHEN $6 = 'baja' THEN coalesce(dado_de_baja_en, $8) END,
              dado_de_baja_por = CASE WHEN $6 = 'baja' THEN coalesce(dado_de_baja_por, $9::uuid) END
        WHERE id = $1`,
      [t.id, t.name, t.cuit, t.currency, t.timezone, t.status, t.billingModule, at, by],
    );
  }
}

interface TicketRow {
  id: string;
  tenant_id: string;
  comercio_nombre: string;
  autor_id: string;
  asunto: string;
  estado: TicketStatus;
  creado_en: Date;
  actualizado_en: Date;
}

const TICKET_SELECT = `
  SELECT t.id, t.tenant_id, c.nombre AS comercio_nombre, t.autor_id, t.asunto, t.estado,
         t.creado_en, t.actualizado_en
    FROM ticket_soporte t JOIN comercio c ON c.id = t.tenant_id`;

function toTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantName: row.comercio_nombre,
    authorId: row.autor_id,
    subject: row.asunto,
    status: row.estado,
    createdAt: row.creado_en,
    updatedAt: row.actualizado_en,
  };
}

export class PgTicketRepository implements TicketRepository {
  constructor(private readonly db: PgDatabase) {}

  async insert(ticket: Omit<Ticket, 'tenantName'>, first: TicketMessage): Promise<void> {
    await this.db.query(
      `INSERT INTO ticket_soporte (id, tenant_id, autor_id, asunto, estado, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        ticket.id,
        ticket.tenantId,
        ticket.authorId,
        ticket.subject,
        ticket.status,
        ticket.createdAt,
        ticket.updatedAt,
      ],
    );
    await this.addMessage(ticket.id, ticket.authorId, first);
  }

  async findById(id: string) {
    const result = await this.db.query<TicketRow>(`${TICKET_SELECT} WHERE t.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) return undefined;
    const messages = await this.db.query<{
      id: string;
      de_soporte: boolean;
      texto: string;
      creado_en: Date;
    }>(
      'SELECT id, de_soporte, texto, creado_en FROM ticket_mensaje WHERE ticket_id = $1 ORDER BY orden',
      [id],
    );
    return {
      ...toTicket(row),
      messages: messages.rows.map((m) => ({
        id: m.id,
        fromSupport: m.de_soporte,
        text: m.texto,
        createdAt: m.creado_en,
      })),
    };
  }

  async listForTenant(tenantId: string, authorId?: string): Promise<Ticket[]> {
    const result = await this.db.query<TicketRow>(
      `${TICKET_SELECT} WHERE t.tenant_id = $1 AND ($2::uuid IS NULL OR t.autor_id = $2)
        ORDER BY t.actualizado_en DESC`,
      [tenantId, authorId ?? null],
    );
    return result.rows.map(toTicket);
  }

  async listAll(status?: TicketStatus): Promise<Ticket[]> {
    const result = await this.db.query<TicketRow>(
      `${TICKET_SELECT} WHERE ($1::text IS NULL OR t.estado = $1) ORDER BY t.actualizado_en DESC`,
      [status ?? null],
    );
    return result.rows.map(toTicket);
  }

  async addMessage(ticketId: string, authorId: string, message: TicketMessage): Promise<void> {
    await this.db.query(
      `INSERT INTO ticket_mensaje (id, ticket_id, autor_id, de_soporte, texto, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [message.id, ticketId, authorId, message.fromSupport, message.text, message.createdAt],
    );
  }

  async setStatus(ticketId: string, status: TicketStatus, at: Date): Promise<void> {
    await this.db.query(
      'UPDATE ticket_soporte SET estado = $2, actualizado_en = $3 WHERE id = $1',
      [ticketId, status, at],
    );
  }
}

type Scalar = string | number | boolean | null;

// El detalle se devuelve plano: los valores anidados se muestran como texto.
function flatten(detail: Record<string, unknown>): Record<string, Scalar> {
  return Object.fromEntries(
    Object.entries(detail).map(([key, value]) => [
      key,
      value === null || ['string', 'number', 'boolean'].includes(typeof value)
        ? (value as Scalar)
        : JSON.stringify(value),
    ]),
  );
}

export class PgTechnicalAuditQuery implements TechnicalAuditQuery {
  constructor(private readonly db: PgDatabase) {}

  async search(filter: TechnicalAuditFilter): Promise<TechnicalAuditEntryView[]> {
    const result = await this.db.query<{
      id: string;
      momento: Date;
      tipo_evento: string;
      actor_id: string | null;
      tenant_id: string | null;
      ip: string | null;
      detalle: Record<string, unknown>;
    }>(
      `SELECT id, momento, tipo_evento, actor_id, tenant_id, ip, detalle
         FROM auditoria_tecnica
        WHERE ($1::timestamptz IS NULL OR momento >= $1)
          AND ($2::timestamptz IS NULL OR momento <= $2)
          AND ($3::text IS NULL OR tipo_evento = $3)
        ORDER BY momento DESC, id
        LIMIT $4`,
      [filter.from ?? null, filter.to ?? null, filter.type ?? null, filter.limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      at: row.momento,
      type: row.tipo_evento,
      actorId: row.actor_id,
      tenantId: row.tenant_id,
      ip: row.ip,
      detail: flatten(row.detalle),
    }));
  }
}

const RECENT_ERRORS = 20;

export class PgPlatformHealthQuery implements PlatformHealthQuery {
  constructor(private readonly db: PgDatabase) {}

  async snapshot(): Promise<PlatformHealth> {
    const errors = await this.db.query<{
      momento: Date;
      detalle: { method?: string; path?: string; error?: string };
    }>(
      `SELECT momento, detalle FROM auditoria_tecnica
        WHERE tipo_evento = 'error_interno' ORDER BY momento DESC LIMIT $1`,
      [RECENT_ERRORS],
    );
    const jobs = await this.db.query<{ pending: number; running: number; failed: number }>(
      `SELECT count(*) FILTER (WHERE estado = 'pendiente')::int AS pending,
              count(*) FILTER (WHERE estado = 'en_curso')::int AS running,
              count(*) FILTER (WHERE estado = 'fallido')::int AS failed
         FROM trabajo_programado`,
    );
    const outbox = await this.db.query<{
      pending: number;
      with_errors: number;
      oldest: Date | null;
    }>(
      `SELECT count(*)::int AS pending,
              count(*) FILTER (WHERE ultimo_error IS NOT NULL)::int AS with_errors,
              min(creado_en) AS oldest
         FROM outbox WHERE procesado_en IS NULL`,
    );
    const peripherals = await this.db.query<{
      momento: Date;
      tenant_id: string;
      comercio: string;
      detalle: { dispositivo?: string; conexion?: string; estado?: string; motivo?: string | null };
    }>(
      `SELECT * FROM (
         SELECT DISTINCT ON (a.tenant_id, a.actor_id, a.detalle->>'dispositivo')
                a.momento, a.tenant_id, c.nombre AS comercio, a.detalle
           FROM auditoria_tecnica a
           JOIN comercio c ON c.id = a.tenant_id
          WHERE a.tipo_evento = 'periferico'
          ORDER BY a.tenant_id, a.actor_id, a.detalle->>'dispositivo', a.momento DESC
       ) ultimos
       WHERE detalle->>'estado' = 'falla'
       ORDER BY momento DESC
       LIMIT $1`,
      [RECENT_ERRORS],
    );
    return {
      failingPeripherals: peripherals.rows.map((row) => ({
        at: row.momento,
        tenantId: row.tenant_id,
        tenantName: row.comercio,
        device: row.detalle.dispositivo ?? '',
        connection: row.detalle.conexion ?? '',
        reason: row.detalle.motivo ?? null,
      })),
      recentErrors: errors.rows.map((row) => ({
        at: row.momento,
        method: row.detalle.method ?? '',
        path: row.detalle.path ?? '',
        error: row.detalle.error ?? '',
      })),
      jobs: jobs.rows[0] ?? { pending: 0, running: 0, failed: 0 },
      outbox: {
        pending: outbox.rows[0]?.pending ?? 0,
        withErrors: outbox.rows[0]?.with_errors ?? 0,
        oldestPendingAt: outbox.rows[0]?.oldest ?? null,
      },
    };
  }
}
