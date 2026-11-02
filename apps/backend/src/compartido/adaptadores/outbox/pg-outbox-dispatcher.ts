// Despachador del outbox (T-022, AD-07).
// Cada evento se toma con FOR UPDATE SKIP LOCKED, se entrega a su manejador y se marca procesado
// en la misma transacción: dos despachadores nunca entregan el mismo evento a la vez.
// Si el manejador falla, o el tipo no tiene manejador, el evento se reintenta más tarde: nunca se descarta.
import type { Clock } from '../../aplicacion/clock.js';
import type { DispatchedEvent, EventHandler } from '../../aplicacion/event-outbox.js';
import type { Logger } from '../../aplicacion/logger.js';
import { redactText } from '../logging/redact.js';
import type { PgDatabase } from '../postgres/pg-database.js';

export interface OutboxDispatcherOptions {
  handlers: Readonly<Record<string, EventHandler>>;
  batchSize?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

interface OutboxRow {
  id: string;
  tenant_id: string | null;
  tipo_evento: string;
  payload: Record<string, unknown>;
  creado_en: Date;
  intentos: number;
}

const MAX_ERROR_LENGTH = 500;

export class PgOutboxDispatcher {
  private readonly batchSize: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;

  constructor(
    private readonly db: PgDatabase,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: OutboxDispatcherOptions,
  ) {
    this.batchSize = options.batchSize ?? 20;
    this.retryBaseMs = options.retryBaseMs ?? 5_000;
    this.retryMaxMs = options.retryMaxMs ?? 10 * 60_000;
  }

  // Despacha hasta un lote de eventos. Devuelve cuántos tomó (entregados o reprogramados).
  async dispatchOnce(): Promise<number> {
    let taken = 0;
    while (taken < this.batchSize && (await this.dispatchNext())) {
      taken++;
    }
    return taken;
  }

  private dispatchNext(): Promise<boolean> {
    return this.db.run(async () => {
      const now = this.clock.now();
      const result = await this.db.query<OutboxRow>(
        `SELECT id, tenant_id, tipo_evento, payload, creado_en, intentos
           FROM outbox
          WHERE procesado_en IS NULL AND proximo_intento <= $1
          ORDER BY creado_en
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [now],
      );
      const row = result.rows[0];
      if (!row) return false;

      try {
        await this.deliver(row);
      } catch (error: unknown) {
        await this.reschedule(row, error);
        return true;
      }
      await this.db.query(
        'UPDATE outbox SET procesado_en = $2, ultimo_error = NULL WHERE id = $1',
        [row.id, this.clock.now()],
      );
      return true;
    });
  }

  private async deliver(row: OutboxRow): Promise<void> {
    const handler = this.options.handlers[row.tipo_evento];
    if (!handler) {
      throw new Error(`No hay manejador para el evento "${row.tipo_evento}".`);
    }
    const event: DispatchedEvent = {
      id: row.id,
      type: row.tipo_evento,
      tenantId: row.tenant_id,
      payload: row.payload,
      occurredAt: row.creado_en,
    };
    await handler(event);
  }

  private async reschedule(row: OutboxRow, error: unknown): Promise<void> {
    const attempts = row.intentos + 1;
    const delay = Math.min(this.retryBaseMs * 2 ** (attempts - 1), this.retryMaxMs);
    const message = redactText(error instanceof Error ? error.message : String(error)).slice(
      0,
      MAX_ERROR_LENGTH,
    );
    this.logger.warn('No se pudo despachar un evento del outbox, se reintentará', {
      eventId: row.id,
      type: row.tipo_evento,
      attempt: attempts,
      error: message,
    });
    await this.db.query(
      'UPDATE outbox SET intentos = $2, proximo_intento = $3, ultimo_error = $4 WHERE id = $1',
      [row.id, attempts, new Date(this.clock.now().getTime() + delay), message],
    );
  }
}
