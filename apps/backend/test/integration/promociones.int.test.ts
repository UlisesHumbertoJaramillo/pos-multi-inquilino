// Promociones del AC: alta con tipos cerrados y vigencia, modificación y baja (T-120; RF-048).
import type { Promotion } from '@pos/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerQuery, ownerSelect } from '../support/database.js';
import {
  BRANCH_B,
  BRANCH_CENTRO,
  seedIdentity,
  signIn,
  TENANT_A,
  USERS,
} from '../support/identity-fixtures.js';

const api = createTestApi();
afterAll(() => api.close());

const BEBIDAS = 'a4000000-0000-4000-8000-000000000001';
const AGUA = 'a5000000-0000-4000-8000-000000000001';

let ac: string;

beforeEach(async () => {
  await seedIdentity();
  await ownerQuery(
    `INSERT INTO categoria (id, tenant_id, nombre, tasa_iva, creado_en)
     VALUES ($1, $2, 'Bebidas', 21, now())`,
    [BEBIDAS, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO producto (id, tenant_id, tipo, nombre, categoria_id, costo, creado_en)
     VALUES ($1, $2, 'simple', 'Agua', $3, 100, now())`,
    [AGUA, TENANT_A, BEBIDAS],
  );
  ac = (await signIn(api.app, USERS.ac.email)).authorization;
});

// El reloj de las pruebas está en 2026-11-02 12:00 UTC.
const twoForOne = {
  nombre: '2x1 en bebidas',
  regla: { tipo: 'nxm', lleva: 2, paga: 1 },
  alcance: 'categoria',
  objetivoId: BEBIDAS,
  vigenteDesde: '2026-11-01T00:00:00Z',
  vigenteHasta: '2026-11-30T23:59:59Z',
  sucursales: null,
};

const create = (body: object) =>
  request(api.app).post('/promociones').set('Authorization', ac).send(body);

describe('[RF-048] promociones', () => {
  it('el AC crea un 2x1 con vigencia y aparece entre las vigentes', async () => {
    const response = await create(twoForOne);

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expectToMatchContract(response, 'post', '/promociones');
    expect(response.body).toMatchObject({
      regla: { tipo: 'nxm', lleva: 2, paga: 1 },
      objetivo: { id: BEBIDAS, nombre: 'Bebidas' },
      vigente: true,
    });
    const future = await create({
      ...twoForOne,
      nombre: '15 % en agua',
      regla: { tipo: 'porcentaje', porcentaje: '15' },
      alcance: 'producto',
      objetivoId: AGUA,
      vigenteDesde: '2026-12-01T00:00:00Z',
      vigenteHasta: '2026-12-31T00:00:00Z',
      sucursales: [BRANCH_CENTRO],
    });
    expect(future.status).toBe(201);

    const current = await request(api.app)
      .get('/promociones?vigentes=true')
      .set('Authorization', ac);
    expectToMatchContract(current, 'get', '/promociones');
    expect((current.body as Promotion[]).map((p) => p.nombre)).toStrictEqual(['2x1 en bebidas']);
    const all = await request(api.app).get('/promociones').set('Authorization', ac);
    expect((all.body as Promotion[]).map((p) => [p.nombre, p.vigente])).toStrictEqual([
      ['15 % en agua', false],
      ['2x1 en bebidas', true],
    ]);
    expect(
      await ownerSelect("SELECT accion FROM auditoria_comercial WHERE entidad = 'promocion'"),
    ).toHaveLength(2);
  });

  it.each([
    [{ regla: { tipo: 'nxm', lleva: 2, paga: 2 } }, 'PROMOCION_INVALIDA'],
    [{ regla: { tipo: 'precio_cantidad', cantidad: 3, precio: '1000' } }, 'PROMOCION_INVALIDA'],
    [{ vigenteHasta: '2026-10-01T00:00:00Z' }, 'VIGENCIA_INVALIDA'],
    [{ sucursales: [BRANCH_B] }, 'PROMOCION_INVALIDA'],
    [{ alcance: 'producto', objetivoId: BEBIDAS }, 'PROMOCION_INVALIDA'],
  ])('rechaza %j', async (change, codigo) => {
    const response = await create({ ...twoForOne, ...change });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo });
  });

  it('el AC modifica la vigencia y da de baja la promoción', async () => {
    const created = (await create(twoForOne)).body as Promotion;

    const updated = await request(api.app)
      .patch(`/promociones/${created.id}`)
      .set('Authorization', ac)
      .send({ vigenteHasta: '2026-11-02T00:00:00Z' });
    expectToMatchContract(updated, 'patch', '/promociones/{id}');
    expect(updated.body).toMatchObject({ vigente: false });

    const deactivated = await request(api.app)
      .post(`/promociones/${created.id}/baja`)
      .set('Authorization', ac);
    expect(deactivated.status).toBe(204);
    const list = await request(api.app).get('/promociones').set('Authorization', ac);
    expect(list.body).toStrictEqual([]);
  });

  it('[RF-004] el AS no crea promociones', async () => {
    const as = (await signIn(api.app, USERS.asVo.email, 'AS')).authorization;

    const response = await request(api.app)
      .post('/promociones')
      .set('Authorization', as)
      .send(twoForOne);

    expect(response.status).toBe(403);
  });
});
