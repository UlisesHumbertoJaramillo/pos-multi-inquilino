// Trabajos programados (T-021, AD-19).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { JobHandler, RunnableJob } from '../../src/compartido/aplicacion/job-scheduler.js';
import { uuidGenerator } from '../../src/compartido/adaptadores/id/uuid-generator.js';
import { PgJobScheduler } from '../../src/compartido/adaptadores/jobs/pg-job-scheduler.js';
import { PgJobWorker } from '../../src/compartido/adaptadores/jobs/pg-job-worker.js';
import { ManualClock } from '../support/clock.js';
import { createTestDatabase, ownerQuery } from '../support/database.js';
import { createMemoryLogger } from '../support/logger.js';

const db = createTestDatabase();
// Otra conexión independiente, como si fuera otro proceso worker.
const otherDb = createTestDatabase();
const MINUTE = 60_000;

let clock: ManualClock;
let scheduler: PgJobScheduler;

function worker(
  workerId: string,
  handlers: Record<string, JobHandler>,
  database = db,
): PgJobWorker {
  return new PgJobWorker(database, clock, createMemoryLogger(), {
    workerId,
    handlers,
    batchSize: 3,
    retryBaseMs: MINUTE,
  });
}

async function jobState(key: string) {
  const result = await db.query<{ estado: string; intentos: number; ultimo_error: string | null }>(
    'SELECT estado, intentos, ultimo_error FROM trabajo_programado WHERE clave = $1',
    [key],
  );
  return result.rows[0];
}

describe('trabajos programados', () => {
  beforeEach(() => {
    clock = new ManualClock('2026-11-02T12:00:00.000Z');
    scheduler = new PgJobScheduler(db, clock, uuidGenerator);
  });

  afterAll(async () => {
    await db.close();
    await otherDb.close();
  });

  it('dos workers en paralelo nunca ejecutan el mismo trabajo dos veces', async () => {
    const total = 40;
    for (let i = 0; i < total; i++) {
      await scheduler.schedule({ type: 'prueba', key: `t-${String(i)}`, runAt: clock.now() });
    }
    const executions = new Map<string, number>();
    const record: JobHandler = async (job: RunnableJob) => {
      executions.set(job.key, (executions.get(job.key) ?? 0) + 1);
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
    };
    const first = worker('worker-1', { prueba: record });
    const second = worker('worker-2', { prueba: record }, otherDb);

    let claimed: number;
    do {
      const [a, b] = await Promise.all([first.runOnce(), second.runOnce()]);
      claimed = a + b;
    } while (claimed > 0);

    expect(executions.size).toBe(total);
    expect([...executions.values()].every((count) => count === 1)).toBe(true);
    const done = await db.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM trabajo_programado WHERE estado = 'completado'",
    );
    expect(done.rows[0]?.total).toBe(total);
  });

  it('programar dos veces el mismo trabajo pendiente no lo duplica', async () => {
    const job = { type: 'expirar-carrito', key: 'venta-1', runAt: clock.now() };

    expect(await scheduler.schedule(job)).toBe(true);
    expect(await scheduler.schedule(job)).toBe(false);
    const count = await db.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM trabajo_programado',
    );
    expect(count.rows[0]?.total).toBe(1);
  });

  it('no ejecuta un trabajo antes de su hora', async () => {
    const executed: string[] = [];
    await scheduler.schedule({
      type: 'prueba',
      key: 'futuro',
      runAt: new Date(clock.now().getTime() + 10 * MINUTE),
    });
    const jobs = worker('w', {
      prueba: (job) => {
        executed.push(job.key);
        return Promise.resolve();
      },
    });

    expect(await jobs.runOnce()).toBe(0);
    clock.advance(10 * MINUTE);
    expect(await jobs.runOnce()).toBe(1);
    expect(executed).toStrictEqual(['futuro']);
  });

  it('reintenta con espera creciente un trabajo que falla y, agotados los intentos, lo marca fallido', async () => {
    await scheduler.schedule({ type: 'falla', key: 'f', runAt: clock.now(), maxAttempts: 2 });
    const jobs = worker('w', {
      falla: () => Promise.reject(new Error('servicio no disponible: Bearer abc123')),
    });

    await jobs.runOnce();
    expect(await jobState('f')).toMatchObject({ estado: 'pendiente', intentos: 1 });
    expect((await jobState('f'))?.ultimo_error).not.toContain('abc123');

    expect(await jobs.runOnce()).toBe(0); // todavía no pasó la espera
    clock.advance(MINUTE);
    await jobs.runOnce();

    expect(await jobState('f')).toMatchObject({ estado: 'fallido', intentos: 2 });
  });

  it('retoma un trabajo que quedó en curso por un worker caído', async () => {
    await scheduler.schedule({ type: 'prueba', key: 'abandonado', runAt: clock.now() });
    await ownerQuery(
      `UPDATE trabajo_programado
          SET estado = 'en_curso', bloqueado_por = 'worker-caido', intentos = 1,
              bloqueado_en = '2026-11-02T11:50:00Z'
        WHERE clave = 'abandonado'`,
    );
    const executed: string[] = [];
    const jobs = worker('worker-nuevo', {
      prueba: (job) => {
        executed.push(job.key);
        return Promise.resolve();
      },
    });

    await jobs.runOnce();

    expect(executed).toStrictEqual(['abandonado']);
    expect(await jobState('abandonado')).toMatchObject({ estado: 'completado', intentos: 2 });
  });

  it('marca fallido un trabajo cuyo tipo no tiene manejador', async () => {
    await scheduler.schedule({ type: 'desconocido', key: 'x', runAt: clock.now() });

    await worker('w', {}).runOnce();

    expect(await jobState('x')).toMatchObject({ estado: 'fallido' });
  });

  it('un trabajo programado dentro de una transacción revertida no queda programado', async () => {
    const attempt = db.run(async () => {
      await scheduler.schedule({ type: 'prueba', key: 'revertido', runAt: clock.now() });
      throw new Error('falla la operación');
    });

    await expect(attempt).rejects.toThrow('falla la operación');
    expect(await jobState('revertido')).toBeUndefined();
  });
});
