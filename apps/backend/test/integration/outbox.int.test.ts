// Outbox transaccional (T-022, AD-07).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  DispatchedEvent,
  EventHandler,
} from '../../src/compartido/aplicacion/event-outbox.js';
import { uuidGenerator } from '../../src/compartido/adaptadores/id/uuid-generator.js';
import { PgEventOutbox } from '../../src/compartido/adaptadores/outbox/pg-event-outbox.js';
import { PgOutboxDispatcher } from '../../src/compartido/adaptadores/outbox/pg-outbox-dispatcher.js';
import { ManualClock } from '../support/clock.js';
import { createTestDatabase, ownerQuery } from '../support/database.js';
import { createMemoryLogger } from '../support/logger.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const db = createTestDatabase();
const otherDb = createTestDatabase();

let clock: ManualClock;
let outbox: PgEventOutbox;
let delivered: DispatchedEvent[];

const recordingHandler: EventHandler = (event) => {
  delivered.push(event);
  return Promise.resolve();
};

function dispatcher(
  handlers: Record<string, EventHandler> = { 'venta.confirmada': recordingHandler },
  database = db,
): PgOutboxDispatcher {
  return new PgOutboxDispatcher(database, clock, createMemoryLogger(), {
    handlers,
    retryBaseMs: 60_000,
  });
}

// Simula un caso de uso: una venta y su evento en la misma unidad de trabajo.
async function confirmSale(id: string, fail = false): Promise<void> {
  await db.run(
    async () => {
      await db.query('INSERT INTO prueba_venta (id) VALUES ($1)', [id]);
      await outbox.add({ type: 'venta.confirmada', tenantId: TENANT, payload: { ventaId: id } });
      if (fail) throw new Error('falla la confirmación');
    },
    { tenantId: TENANT },
  );
}

describe('outbox transaccional', () => {
  beforeAll(async () => {
    await ownerQuery('CREATE TABLE prueba_venta (id text PRIMARY KEY)');
  });

  beforeEach(() => {
    clock = new ManualClock('2026-11-02T12:00:00.000Z');
    outbox = new PgEventOutbox(db, clock, uuidGenerator);
    delivered = [];
  });

  afterAll(async () => {
    await db.close();
    await otherDb.close();
    await ownerQuery('DROP TABLE prueba_venta');
  });

  it('un evento escrito en una transacción revertida no se despacha', async () => {
    await expect(confirmSale('v-revertida', true)).rejects.toThrow('falla la confirmación');

    await dispatcher().dispatchOnce();

    expect(delivered).toHaveLength(0);
    const pending = await db.query('SELECT 1 FROM outbox');
    expect(pending.rowCount).toBe(0);
  });

  it('un evento escrito en una transacción confirmada se despacha una vez', async () => {
    await confirmSale('v-1');

    const first = await dispatcher().dispatchOnce();
    const second = await dispatcher().dispatchOnce();

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      type: 'venta.confirmada',
      tenantId: TENANT,
      payload: { ventaId: 'v-1' },
    });
    const row = await db.query<{ procesado_en: Date | null }>('SELECT procesado_en FROM outbox');
    expect(row.rows[0]?.procesado_en).toStrictEqual(clock.now());
  });

  it('no permite escribir un evento fuera de una unidad de trabajo', async () => {
    await expect(
      outbox.add({ type: 'venta.confirmada', payload: { ventaId: 'suelta' } }),
    ).rejects.toThrow('solo se escribe dentro de una unidad de trabajo');
  });

  it('si el manejador falla, reintenta más tarde y no pierde el evento', async () => {
    await confirmSale('v-falla');
    let calls = 0;
    const flaky = dispatcher({
      'venta.confirmada': (event) => {
        calls++;
        return calls === 1 ? Promise.reject(new Error('sin conexión')) : recordingHandler(event);
      },
    });

    await flaky.dispatchOnce();
    expect(delivered).toHaveLength(0);
    expect(await flaky.dispatchOnce()).toBe(0); // todavía no pasó la espera

    clock.advance(60_000);
    await flaky.dispatchOnce();

    expect(delivered).toHaveLength(1);
    const row = await db.query<{ intentos: number; procesado_en: Date | null }>(
      'SELECT intentos, procesado_en FROM outbox',
    );
    expect(row.rows[0]?.intentos).toBe(1);
    expect(row.rows[0]?.procesado_en).not.toBeNull();
  });

  it('un evento sin manejador queda pendiente en lugar de descartarse', async () => {
    await confirmSale('v-sin-manejador');

    await dispatcher({}).dispatchOnce();

    const row = await db.query<{ procesado_en: Date | null; ultimo_error: string }>(
      'SELECT procesado_en, ultimo_error FROM outbox',
    );
    expect(row.rows[0]?.procesado_en).toBeNull();
    expect(row.rows[0]?.ultimo_error).toContain('No hay manejador');
  });

  it('dos despachadores en paralelo nunca entregan el mismo evento dos veces', async () => {
    for (let i = 0; i < 25; i++) await confirmSale(`v-${String(i)}`);
    const slowHandler: EventHandler = async (event) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
      delivered.push(event);
    };
    const first = dispatcher({ 'venta.confirmada': slowHandler });
    const second = dispatcher({ 'venta.confirmada': slowHandler }, otherDb);

    let taken: number;
    do {
      const [a, b] = await Promise.all([first.dispatchOnce(), second.dispatchOnce()]);
      taken = a + b;
    } while (taken > 0);

    const ids = delivered.map((event) => event.payload.ventaId);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
  });
});
