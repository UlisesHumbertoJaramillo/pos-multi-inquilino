// Base reutilizable de bajas lógicas (T-023, AD-18).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PgSoftDeleteTable } from '../../src/compartido/adaptadores/postgres/soft-delete-table.js';
import { createTestDatabase, ownerQuery, withAppClient } from '../support/database.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const AT = new Date('2026-11-02T12:00:00.000Z');

interface SampleRow {
  id: string;
  tenant_id: string;
  nombre: string;
  is_active: boolean;
  desactivado_en: Date | null;
  desactivado_por: string | null;
}

const db = createTestDatabase();
const table = new PgSoftDeleteTable<SampleRow>(db, 'prueba_entidad');

describe('[RF-020] [RF-021] bajas lógicas', () => {
  beforeAll(async () => {
    // Entidad de ejemplo con las columnas de baja lógica de la guía de módulos.
    await ownerQuery(`
      CREATE TABLE prueba_entidad (
        id              text        PRIMARY KEY,
        tenant_id       uuid        NOT NULL,
        nombre          text        NOT NULL,
        is_active       boolean     NOT NULL DEFAULT true,
        desactivado_en  timestamptz,
        desactivado_por uuid,
        CONSTRAINT prueba_entidad_baja_completa CHECK (
          is_active = (desactivado_en IS NULL)
          AND (desactivado_en IS NULL) = (desactivado_por IS NULL)
        )
      )`);
  });

  beforeEach(async () => {
    await db.query(
      `INSERT INTO prueba_entidad (id, tenant_id, nombre) VALUES
         ('p1', $1, 'Yerba'), ('p2', $1, 'Azúcar'), ('p3', $2, 'Café')`,
      [TENANT_A, TENANT_B],
    );
  });

  afterAll(async () => {
    await db.close();
    await ownerQuery('DROP TABLE prueba_entidad');
  });

  it('una entidad dada de baja deja de listarse pero sigue en la base con su historial', async () => {
    expect(await table.deactivate(TENANT_A, 'p1', ADMIN, AT)).toBe('deactivated');

    const active = await table.list(TENANT_A);
    expect(active.map((row) => row.id)).toStrictEqual(['p2']);
    expect(await table.findById(TENANT_A, 'p1')).toBeUndefined();

    const history = await table.findById(TENANT_A, 'p1', { includeInactive: true });
    expect(history).toMatchObject({
      nombre: 'Yerba',
      is_active: false,
      desactivado_en: AT,
      desactivado_por: ADMIN,
    });
  });

  it('dar de baja dos veces informa que ya estaba dada de baja, sin cambiar su historial', async () => {
    await table.deactivate(TENANT_A, 'p1', ADMIN, AT);

    const second = await table.deactivate(TENANT_A, 'p1', TENANT_B, new Date('2027-01-01'));

    expect(second).toBe('already_inactive');
    const row = await table.findById(TENANT_A, 'p1', { includeInactive: true });
    expect(row?.desactivado_por).toBe(ADMIN);
    expect(row?.desactivado_en).toStrictEqual(AT);
  });

  it('no ve ni da de baja registros de otro comercio', async () => {
    expect(await table.findById(TENANT_A, 'p3')).toBeUndefined();
    expect(await table.deactivate(TENANT_A, 'p3', ADMIN, AT)).toBe('not_found');
    expect((await table.findById(TENANT_B, 'p3'))?.is_active).toBe(true);
  });

  it('la base rechaza una baja a medias, sin quién o sin cuándo', async () => {
    await expect(
      db.query("UPDATE prueba_entidad SET is_active = false WHERE id = 'p2'"),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('la aplicación no puede borrar físicamente la entidad', async () => {
    await expect(
      withAppClient((client) => client.query("DELETE FROM prueba_entidad WHERE id = 'p2'")),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('solo acepta nombres de tabla simples', () => {
    expect(() => new PgSoftDeleteTable(db, 'prueba; DROP TABLE x')).toThrow('no válido');
  });
});
