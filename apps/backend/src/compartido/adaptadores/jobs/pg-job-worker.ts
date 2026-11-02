// Worker de trabajos programados (T-021, AD-19).
// Toma trabajos con FOR UPDATE SKIP LOCKED: dos workers nunca toman el mismo trabajo a la vez.
// Un trabajo que falla se reintenta con espera creciente; agotados los intentos, queda fallido.
// Si un worker se cae a mitad de un trabajo, otro lo retoma cuando vence el plazo de bloqueo.
import type { Clock } from '../../aplicacion/clock.js';
import type { JobHandler, RunnableJob } from '../../aplicacion/job-scheduler.js';
import type { Logger } from '../../aplicacion/logger.js';
import { redactText } from '../logging/redact.js';
import type { PgDatabase } from '../postgres/pg-database.js';

export interface JobWorkerOptions {
  workerId: string;
  handlers: Readonly<Record<string, JobHandler>>;
  batchSize?: number;
  // Tiempo tras el cual un trabajo en curso se considera abandonado por su worker.
  lockTimeoutMs?: number;
  // Espera antes del primer reintento; se duplica en cada intento.
  retryBaseMs?: number;
  retryMaxMs?: number;
}

interface ClaimedRow {
  id: string;
  tipo: string;
  clave: string;
  payload: Record<string, unknown>;
  intentos: number;
  max_intentos: number;
}

const MAX_ERROR_LENGTH = 500;

export class PgJobWorker {
  private readonly batchSize: number;
  private readonly lockTimeoutMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;

  constructor(
    private readonly db: PgDatabase,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: JobWorkerOptions,
  ) {
    this.batchSize = options.batchSize ?? 10;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5 * 60_000;
    this.retryBaseMs = options.retryBaseMs ?? 10_000;
    this.retryMaxMs = options.retryMaxMs ?? 15 * 60_000;
  }

  // Toma un lote de trabajos listos y los ejecuta. Devuelve cuántos tomó.
  async runOnce(): Promise<number> {
    const claimed = await this.claim();
    for (const row of claimed) {
      await this.execute(row);
    }
    return claimed.length;
  }

  private async claim(): Promise<ClaimedRow[]> {
    const now = this.clock.now();
    const staleBefore = new Date(now.getTime() - this.lockTimeoutMs);
    const result = await this.db.query<ClaimedRow>(
      `UPDATE trabajo_programado
          SET estado = 'en_curso', bloqueado_por = $1, bloqueado_en = $2, intentos = intentos + 1
        WHERE id IN (
          SELECT id FROM trabajo_programado
           WHERE (estado = 'pendiente' AND ejecutar_en <= $2)
              OR (estado = 'en_curso' AND bloqueado_en < $3)
           ORDER BY ejecutar_en
           LIMIT $4
           FOR UPDATE SKIP LOCKED)
       RETURNING id, tipo, clave, payload, intentos, max_intentos`,
      [this.options.workerId, now, staleBefore, this.batchSize],
    );
    return result.rows;
  }

  private async execute(row: ClaimedRow): Promise<void> {
    if (row.intentos > row.max_intentos) {
      await this.markFailed(row, 'Se agotaron los intentos.');
      return;
    }
    const handler = this.options.handlers[row.tipo];
    if (!handler) {
      await this.markFailed(row, `No hay manejador para el tipo de trabajo "${row.tipo}".`);
      return;
    }

    const job: RunnableJob = {
      id: row.id,
      type: row.tipo,
      key: row.clave,
      payload: row.payload,
      attempt: row.intentos,
    };
    try {
      await handler(job);
    } catch (error: unknown) {
      await this.handleFailure(row, error);
      return;
    }
    await this.db.query(
      `UPDATE trabajo_programado
          SET estado = 'completado', completado_en = $3, bloqueado_por = NULL, bloqueado_en = NULL
        WHERE id = $1 AND bloqueado_por = $2`,
      [row.id, this.options.workerId, this.clock.now()],
    );
  }

  private async handleFailure(row: ClaimedRow, error: unknown): Promise<void> {
    const message = describeError(error);
    if (row.intentos >= row.max_intentos) {
      await this.markFailed(row, message);
      return;
    }
    const delay = Math.min(this.retryBaseMs * 2 ** (row.intentos - 1), this.retryMaxMs);
    this.logger.warn('Trabajo fallido, se reintentará', {
      jobId: row.id,
      type: row.tipo,
      attempt: row.intentos,
      error: message,
    });
    await this.db.query(
      `UPDATE trabajo_programado
          SET estado = 'pendiente', ejecutar_en = $3, ultimo_error = $4,
              bloqueado_por = NULL, bloqueado_en = NULL
        WHERE id = $1 AND bloqueado_por = $2`,
      [row.id, this.options.workerId, new Date(this.clock.now().getTime() + delay), message],
    );
  }

  private async markFailed(row: ClaimedRow, message: string): Promise<void> {
    this.logger.error('Trabajo fallido definitivamente', {
      jobId: row.id,
      type: row.tipo,
      attempt: row.intentos,
      error: message,
    });
    await this.db.query(
      `UPDATE trabajo_programado
          SET estado = 'fallido', ultimo_error = $3, bloqueado_por = NULL, bloqueado_en = NULL
        WHERE id = $1 AND bloqueado_por = $2`,
      [row.id, this.options.workerId, message],
    );
  }
}

// El error se guarda en la base: sin secretos y con un largo acotado.
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactText(message).slice(0, MAX_ERROR_LENGTH);
}
