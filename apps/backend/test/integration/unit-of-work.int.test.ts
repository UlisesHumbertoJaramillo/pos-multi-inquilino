// Unidad de trabajo sobre PostgreSQL (T-020, Const. 6).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, ownerQuery } from '../support/database.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const db = createTestDatabase();

async function countRows(): Promise<number> {
  const result = await db.query<{ total: number }>('SELECT count(*)::int AS total FROM prueba_uow');
  return result.rows[0]?.total ?? -1;
}

async function insert(valor: string): Promise<void> {
  await db.query('INSERT INTO prueba_uow (valor) VALUES ($1)', [valor]);
}

describe('unidad de trabajo (PgDatabase)', () => {
  beforeAll(async () => {
    await ownerQuery('CREATE TABLE prueba_uow (id serial PRIMARY KEY, valor text NOT NULL)');
  });

  afterAll(async () => {
    await db.close();
    await ownerQuery('DROP TABLE prueba_uow');
  });

  it('confirma lo que hace el trabajo cuando termina bien', async () => {
    await db.run(async () => {
      await insert('confirmada');
    });

    expect(await countRows()).toBe(1);
  });

  it('un rollback deshace la inserción y el error llega a quien llamó', async () => {
    const failure = db.run(async () => {
      await insert('revertida');
      expect(await countRows()).toBe(1); // dentro de la transacción se ve
      throw new Error('falla después de insertar');
    });

    await expect(failure).rejects.toThrow('falla después de insertar');
    expect(await countRows()).toBe(0);
  });

  it('una unidad de trabajo anidada se suma a la de afuera y se revierte con ella', async () => {
    const failure = db.run(async () => {
      await insert('afuera');
      await db.run(async () => {
        await insert('adentro');
      });
      throw new Error('falla la de afuera');
    });

    await expect(failure).rejects.toThrow('falla la de afuera');
    expect(await countRows()).toBe(0);
  });

  it('transacciones simultáneas no se mezclan', async () => {
    const results = await Promise.allSettled([
      db.run(async () => {
        await insert('se confirma');
      }),
      db.run(async () => {
        await insert('se revierte');
        throw new Error('revertir');
      }),
    ]);

    expect(results.map((result) => result.status)).toStrictEqual(['fulfilled', 'rejected']);
    const rows = await db.query<{ valor: string }>('SELECT valor FROM prueba_uow');
    expect(rows.rows).toStrictEqual([{ valor: 'se confirma' }]);
  });

  it('fija el comercio solo durante la transacción', async () => {
    const setting = "SELECT current_setting('app.tenant_id', true) AS tenant";

    const inside = await db.run(
      async () => (await db.query<{ tenant: string | null }>(setting)).rows[0]?.tenant,
      { tenantId: TENANT_A },
    );
    const outside = await db.run(
      async () => (await db.query<{ tenant: string | null }>(setting)).rows[0]?.tenant,
    );

    expect(inside).toBe(TENANT_A);
    expect(outside ?? '').toBe('');
  });

  it('no deja que una transacción anidada cambie de comercio', async () => {
    const attempt = db.run(
      () => db.run(() => Promise.resolve(), { tenantId: '22222222-2222-4222-8222-222222222222' }),
      { tenantId: TENANT_A },
    );

    await expect(attempt).rejects.toThrow('no puede cambiar de comercio');
  });
});
