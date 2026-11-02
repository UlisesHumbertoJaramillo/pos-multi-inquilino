// Pool de conexiones de la aplicación: siempre con el rol pos_app (sin DELETE, con RLS).
import pg from 'pg';
import type { Logger } from '../../aplicacion/logger.js';

const APP_ROLE = 'pos_app';

export function appDatabaseConfigFromEnv(env: NodeJS.ProcessEnv): pg.PoolConfig {
  const password = env.DB_APP_PASSWORD;
  if (!password) {
    throw new Error('Falta DB_APP_PASSWORD. Corré `npm run db:setup`.');
  }
  return {
    host: env.DB_HOST ?? 'localhost',
    port: Number(env.DB_PORT ?? '5432'),
    database: env.DB_NAME ?? 'pos_dev',
    user: APP_ROLE,
    password,
  };
}

export function createPgPool(config: pg.PoolConfig, logger: Logger): pg.Pool {
  const pool = new pg.Pool(config);
  // Un error en una conexión inactiva no debe tirar abajo el proceso.
  pool.on('error', (error) => {
    logger.error('Error en una conexión inactiva de PostgreSQL', { err: error });
  });
  return pool;
}
