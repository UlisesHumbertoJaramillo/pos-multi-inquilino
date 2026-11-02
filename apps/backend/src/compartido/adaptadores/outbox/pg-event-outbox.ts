// Adaptador del puerto EventOutbox sobre la tabla outbox (T-022, AD-07).
import type { Clock } from '../../aplicacion/clock.js';
import type { EventOutbox, OutboxEvent } from '../../aplicacion/event-outbox.js';
import type { IdGenerator } from '../../aplicacion/id-generator.js';
import type { PgDatabase } from '../postgres/pg-database.js';

export class PgEventOutbox implements EventOutbox {
  constructor(
    private readonly db: PgDatabase,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async add(event: OutboxEvent): Promise<void> {
    // Fuera de una transacción, el evento podría quedar escrito aunque el cambio falle.
    if (!this.db.inTransaction) {
      throw new Error('El outbox solo se escribe dentro de una unidad de trabajo.');
    }
    const now = this.clock.now();
    await this.db.query(
      `INSERT INTO outbox (id, tenant_id, tipo_evento, payload, creado_en, proximo_intento)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [this.ids.next(), event.tenantId ?? null, event.type, JSON.stringify(event.payload), now],
    );
  }
}
