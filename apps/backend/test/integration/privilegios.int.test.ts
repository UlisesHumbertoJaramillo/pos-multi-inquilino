// Privilegios por defecto del rol de la aplicación (T-009, AD-18).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ownerQuery, withAppClient } from '../support/database.js';

describe('[RF-021] privilegios de pos_app sobre las tablas nuevas', () => {
  beforeAll(async () => {
    // La crea pos_owner, como cualquier migración: recibe los privilegios por defecto.
    await ownerQuery('CREATE TABLE prueba_privilegios (id serial PRIMARY KEY, valor text)');
  });

  afterAll(async () => {
    await ownerQuery('DROP TABLE prueba_privilegios');
  });

  beforeEach(async () => {
    await withAppClient((client) =>
      client.query("INSERT INTO prueba_privilegios (valor) VALUES ('original')"),
    );
  });

  it('puede leer, insertar y actualizar', async () => {
    const valores = await withAppClient(async (client) => {
      await client.query("UPDATE prueba_privilegios SET valor = 'modificado'");
      const result = await client.query<{ valor: string }>('SELECT valor FROM prueba_privilegios');
      return result.rows.map((row) => row.valor);
    });

    expect(valores).toStrictEqual(['modificado']);
  });

  it('no puede borrar filas físicamente', async () => {
    await expect(
      withAppClient((client) => client.query('DELETE FROM prueba_privilegios')),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('no puede vaciar la tabla', async () => {
    await expect(
      withAppClient((client) => client.query('TRUNCATE prueba_privilegios')),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('no puede leer la tabla de control de migraciones', async () => {
    await expect(
      withAppClient((client) => client.query('SELECT * FROM pgmigrations')),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
