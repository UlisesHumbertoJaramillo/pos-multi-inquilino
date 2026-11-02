// Adaptador del puerto JobScheduler sobre la tabla trabajo_programado (T-021).
import type { Clock } from '../../aplicacion/clock.js';
import type { IdGenerator } from '../../aplicacion/id-generator.js';
import type { JobScheduler, ScheduledJob } from '../../aplicacion/job-scheduler.js';
import type { PgDatabase } from '../postgres/pg-database.js';

const DEFAULT_MAX_ATTEMPTS = 5;

export class PgJobScheduler implements JobScheduler {
  constructor(
    private readonly db: PgDatabase,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async schedule(job: ScheduledJob): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO trabajo_programado (id, tipo, clave, payload, ejecutar_en, max_intentos, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tipo, clave) WHERE estado IN ('pendiente', 'en_curso') DO NOTHING`,
      [
        this.ids.next(),
        job.type,
        job.key,
        JSON.stringify(job.payload ?? {}),
        job.runAt,
        job.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        this.clock.now(),
      ],
    );
    return result.rowCount === 1;
  }
}
