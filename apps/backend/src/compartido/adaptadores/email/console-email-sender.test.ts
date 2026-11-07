import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { apiConfigFromEnv, createApi } from '../../../composition.js';
import { PgDatabase } from '../postgres/pg-database.js';
import { createMemoryLogger } from '../../../../test/support/logger.js';
import { systemClock } from '../clock/system-clock.js';
import { ConsoleEmailSender, createEmailSender } from './console-email-sender.js';
import pg from 'pg';

describe('correo por consola', () => {
  it('escribe el correo con su enlace en la salida indicada', async () => {
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });

    await new ConsoleEmailSender(output).send({
      to: 'vo@demo.local',
      subject: 'Validá tu correo',
      text: 'Abrí este enlace:\nhttps://localhost:5173/validar-correo?token=abc',
    });

    const text = chunks.join('');
    expect(text).toContain('Para:   vo@demo.local');
    expect(text).toContain('validar-correo?token=abc');
  });

  it('no se permite en producción', () => {
    expect(() => createEmailSender({ adapter: 'console', production: true })).toThrow(
      'no se permite en producción',
    );
    expect(createEmailSender({ adapter: 'console', production: false })).toBeInstanceOf(
      ConsoleEmailSender,
    );
  });

  it('el backend no arranca en modo producción con el adaptador de consola', () => {
    const config = apiConfigFromEnv({
      NODE_ENV: 'production',
      FISCAL_MASTER_KEY: 'clave-de-prueba',
      AUTH_TOKEN_SECRET: 'x'.repeat(48),
      EMAIL_ADAPTER: 'console',
    });
    // El pool no se conecta hasta la primera consulta: la prueba no necesita una base.
    const db = new PgDatabase(new pg.Pool());

    expect(() =>
      createApi(config, { db, clock: systemClock, logger: createMemoryLogger() }),
    ).toThrow('no se permite en producción');
  });
});
