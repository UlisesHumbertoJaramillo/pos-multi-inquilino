// Proceso worker: ejecuta los trabajos programados y despacha el outbox (AD-07, AD-19).
// Es el mismo código del backend en otro proceso. Raíz de composición, como server.ts.
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { EventHandler } from './compartido/aplicacion/event-outbox.js';
import type { JobHandler } from './compartido/aplicacion/job-scheduler.js';
import { systemClock } from './compartido/adaptadores/clock/system-clock.js';
import { PgJobWorker } from './compartido/adaptadores/jobs/pg-job-worker.js';
import { createPinoLogger } from './compartido/adaptadores/logging/pino-logger.js';
import { PgOutboxDispatcher } from './compartido/adaptadores/outbox/pg-outbox-dispatcher.js';
import { PgDatabase } from './compartido/adaptadores/postgres/pg-database.js';
import { appDatabaseConfigFromEnv, createPgPool } from './compartido/adaptadores/postgres/pool.js';

const ENV_PATH = resolve(import.meta.dirname, '../../../.env');
if (existsSync(ENV_PATH)) {
  // No pisa las variables ya definidas en el entorno.
  process.loadEnvFile(ENV_PATH);
}

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS ?? '1000');
const WORKER_ID = `${hostname()}:${String(process.pid)}`;

// Manejadores por tipo de trabajo y de evento. Cada módulo agrega los suyos cuando los necesita.
const JOB_HANDLERS: Record<string, JobHandler> = {};
const EVENT_HANDLERS: Record<string, EventHandler> = {};

const logger = createPinoLogger();
const db = new PgDatabase(createPgPool(appDatabaseConfigFromEnv(process.env), logger));
const jobs = new PgJobWorker(db, systemClock, logger, {
  workerId: WORKER_ID,
  handlers: JOB_HANDLERS,
});
const outbox = new PgOutboxDispatcher(db, systemClock, logger, { handlers: EVENT_HANDLERS });

let running = true;

async function loop(): Promise<void> {
  logger.info('Worker iniciado', { workerId: WORKER_ID });
  while (running) {
    try {
      const dispatched = await outbox.dispatchOnce();
      const claimed = await jobs.runOnce();
      // Si había trabajo, se sigue sin esperar; si no, se espera al próximo ciclo.
      if (dispatched + claimed === 0) await sleep(POLL_INTERVAL_MS);
    } catch (error: unknown) {
      logger.error('Error en el ciclo del worker', { err: error });
      await sleep(POLL_INTERVAL_MS);
    }
  }
  await db.close();
  logger.info('Worker detenido', { workerId: WORKER_ID });
}

// Detención ordenada: termina el lote en curso y cierra las conexiones.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    running = false;
  });
}

await loop();
