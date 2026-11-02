// Seguridad a nivel de fila por comercio (T-039, AD-03).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, ownerQuery } from '../support/database.js';
import { seedIdentity, TENANT_A, TENANT_B } from '../support/identity-fixtures.js';

const db = createTestDatabase();

async function countRows(tenantId?: string): Promise<number> {
  return db.run(
    async () => {
      const result = await db.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM prueba_comercial',
      );
      return result.rows[0]?.total ?? -1;
    },
    tenantId === undefined ? {} : { tenantId },
  );
}

describe('[RF-001] aislamiento por comercio en la base', () => {
  beforeAll(async () => {
    // Una tabla comercial cualquiera, aislada con la política plantilla.
    await ownerQuery(`
      CREATE TABLE prueba_comercial (
        id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        dato      text NOT NULL
      )`);
    await ownerQuery("SELECT aplicar_aislamiento_por_comercio('prueba_comercial')");
  });

  beforeEach(async () => {
    await seedIdentity();
    await ownerQuery(
      `INSERT INTO prueba_comercial (tenant_id, dato) VALUES ($1, 'a1'), ($1, 'a2'), ($2, 'b1')`,
      [TENANT_A, TENANT_B],
    );
  });

  afterAll(async () => {
    await db.close();
    await ownerQuery('DROP TABLE prueba_comercial');
  });

  it('una consulta sin comercio fijado devuelve 0 filas', async () => {
    expect(await countRows()).toBe(0);
    // Tampoco fuera de una transacción.
    const outside = await db.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM prueba_comercial',
    );
    expect(outside.rows[0]?.total).toBe(0);
  });

  it('con el comercio fijado, solo se ven sus filas', async () => {
    expect(await countRows(TENANT_A)).toBe(2);
    expect(await countRows(TENANT_B)).toBe(1);
  });

  it('no se puede escribir una fila de otro comercio', async () => {
    const attempt = db.run(
      () =>
        db.query("INSERT INTO prueba_comercial (tenant_id, dato) VALUES ($1, 'intruso')", [
          TENANT_B,
        ]),
      { tenantId: TENANT_A },
    );

    await expect(attempt).rejects.toMatchObject({ code: '42501' });
  });

  it('no se puede mover una fila propia a otro comercio', async () => {
    const attempt = db.run(
      () => db.query('UPDATE prueba_comercial SET tenant_id = $1', [TENANT_B]),
      {
        tenantId: TENANT_A,
      },
    );

    await expect(attempt).rejects.toMatchObject({ code: '42501' });
  });

  it('las tablas comerciales del sistema tienen la política aplicada', async () => {
    const result = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies
        WHERE policyname = 'aislamiento_por_comercio' ORDER BY tablename`,
    );
    expect(result.rows.map((row) => row.tablename)).toEqual(
      expect.arrayContaining(['auditoria_comercial', 'autorizacion', 'credencial_autorizacion']),
    );
  });
});
