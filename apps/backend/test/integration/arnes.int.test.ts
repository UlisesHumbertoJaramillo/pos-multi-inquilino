// Verifica el propio arnés de integración (T-010): usa pos_test y vacía las tablas entre pruebas.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownerQuery, TEST_DATABASE, withAppClient } from '../support/database.js';

describe('arnés de pruebas de integración', () => {
  beforeAll(async () => {
    await ownerQuery('CREATE TABLE prueba_arnes (id serial PRIMARY KEY)');
  });

  afterAll(async () => {
    await ownerQuery('DROP TABLE prueba_arnes');
  });

  it('se conecta a pos_test con el rol de la aplicación, nunca a pos_dev', async () => {
    const row = await withAppClient(async (client) => {
      const result = await client.query<{ db: string; usr: string }>(
        'SELECT current_database() AS db, current_user AS usr',
      );
      return result.rows[0];
    });

    expect(row).toStrictEqual({ db: TEST_DATABASE, usr: 'pos_app' });
  });

  it('inserta una fila', async () => {
    await withAppClient((client) => client.query('INSERT INTO prueba_arnes DEFAULT VALUES'));
  });

  it('empieza cada prueba con las tablas vacías', async () => {
    const count = await withAppClient(async (client) => {
      const result = await client.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM prueba_arnes',
      );
      return result.rows[0]?.total;
    });

    expect(count).toBe(0);
  });
});
