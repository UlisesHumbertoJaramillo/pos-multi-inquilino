// Acceso a PostgreSQL y adaptador del puerto UnitOfWork (T-020).
// La transacción en curso se guarda en el contexto asíncrono: los repositorios llaman a `query`
// y participan de ella sin recibir el cliente, y los casos de uso no ven nada de PostgreSQL.
import { AsyncLocalStorage } from 'node:async_hooks';
import type pg from 'pg';
import type { TransactionOptions, UnitOfWork } from '../../aplicacion/unit-of-work.js';

interface ActiveTransaction {
  client: pg.PoolClient;
  tenantId: string | undefined;
}

export class PgDatabase implements UnitOfWork {
  private readonly transactions = new AsyncLocalStorage<ActiveTransaction>();

  constructor(private readonly pool: pg.Pool) {}

  get inTransaction(): boolean {
    return this.transactions.getStore() !== undefined;
  }

  // Usa la transacción en curso, o una conexión del pool si no hay ninguna.
  // Siempre con parámetros: nunca se arma SQL concatenando valores (Const. 17).
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>> {
    const executor = this.transactions.getStore()?.client ?? this.pool;
    return executor.query<R>(text, values);
  }

  // Siempre con una conexión propia, fuera de la transacción en curso: lo que escribe queda
  // aunque esa transacción se revierta (por ejemplo, la auditoría técnica de un acceso denegado).
  queryOutsideTransaction<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(text, values);
  }

  async run<T>(work: () => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const current = this.transactions.getStore();
    if (current) {
      // Una unidad de trabajo dentro de otra se suma a la transacción de afuera.
      if (options.tenantId !== undefined && options.tenantId !== current.tenantId) {
        throw new Error('Una transacción anidada no puede cambiar de comercio.');
      }
      return work();
    }

    const client = await this.pool.connect();
    let connectionBroken = false;
    try {
      await client.query('BEGIN');
      if (options.tenantId !== undefined) {
        // `true`: vale solo hasta el final de esta transacción.
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [options.tenantId]);
      }
      const result = await this.transactions.run({ client, tenantId: options.tenantId }, work);
      await client.query('COMMIT');
      return result;
    } catch (error: unknown) {
      await client.query('ROLLBACK').catch(() => {
        connectionBroken = true;
      });
      throw error;
    } finally {
      // Una conexión que no pudo revertir se descarta en lugar de volver al pool.
      client.release(connectionBroken);
    }
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
