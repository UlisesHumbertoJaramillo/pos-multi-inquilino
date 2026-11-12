// Atajos de teclado del POS por comercio (T-274; RF-185, D-94, AD-28).
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerSelect } from '../support/database.js';
import { seedIdentity, signIn, TENANT_A, USERS } from '../support/identity-fixtures.js';

const api = createTestApi();
afterAll(() => api.close());

let ac: string;
let acB: string;
let as: string;
let vo: string;

beforeEach(async () => {
  await seedIdentity();
  ac = (await signIn(api.app, USERS.ac.email, 'AC')).authorization;
  acB = (await signIn(api.app, USERS.acB.email)).authorization;
  as = (await signIn(api.app, USERS.asVo.email, 'AS')).authorization;
  vo = (await signIn(api.app, USERS.vo.email, 'VO')).authorization;
});

const get = (path: string, token: string) => request(api.app).get(path).set('Authorization', token);
const put = (token: string, atajos: Record<string, string | null>) =>
  request(api.app).put('/organizacion/atajos').set('Authorization', token).send({ atajos });

interface Shortcuts {
  porDefecto: boolean;
  atajos: { accion: string; tecla: string | null }[];
}
const keyOf = (body: unknown, action: string) =>
  (body as Shortcuts).atajos.find((a) => a.accion === action)?.tecla;

describe('[RF-185] atajos del POS de cada comercio', () => {
  it('sin cambios rige la distribución por defecto, de la mano derecha', async () => {
    const response = await get('/atajos', vo);
    expect(response.status).toBe(200);
    expectToMatchContract(response, 'get', '/atajos');
    expect((response.body as Shortcuts).porDefecto).toBe(true);
    expect(keyOf(response.body, 'cobrar')).toBe('NumpadAdd');
    expect(keyOf(response.body, 'cantidad')).toBe('NumpadMultiply');
  });

  it('el AC cambia un atajo, el POS lo usa y queda en la auditoría', async () => {
    const saved = await put(ac, { cobrar: 'F2' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expectToMatchContract(saved, 'put', '/organizacion/atajos');

    const pos = await get('/atajos', vo);
    expect((pos.body as Shortcuts).porDefecto).toBe(false);
    expect(keyOf(pos.body, 'cobrar')).toBe('F2');
    const audit = await ownerSelect<{ accion: string }>(
      "SELECT accion FROM auditoria_comercial WHERE entidad = 'atajos_comercio'",
    );
    expect(audit).toEqual([{ accion: 'atajos.cambiar' }]);
  });

  it('una tecla repetida o reservada se rechaza con su motivo, sin cambiar nada', async () => {
    const repeated = await put(ac, { cobrar: 'F9' });
    expect(repeated.status).toBe(409);
    expect(repeated.body).toMatchObject({ codigo: 'ATAJO_REPETIDO' });
    expect((await put(ac, { corte_x: 'F5' })).body).toMatchObject({ codigo: 'ATAJO_RESERVADO' });
    expect((await get('/atajos', vo)).body).toMatchObject({ porDefecto: true });
  });

  it('el AC vuelve a la distribución por defecto', async () => {
    await put(ac, { cobrar: 'F2' });
    const reset = await request(api.app)
      .post('/organizacion/atajos/restablecimiento')
      .set('Authorization', ac);
    expect(reset.status).toBe(200);
    expect(keyOf((await get('/atajos', vo)).body, 'cobrar')).toBe('NumpadAdd');
    // Se conserva la fila: restablecer no borra nada.
    expect(await ownerSelect('SELECT mapa FROM atajos_comercio')).toEqual([{ mapa: null }]);
  });

  it('el AS y el VO no los cambian, y otro comercio no ve los del comercio A', async () => {
    expect((await put(as, { cobrar: 'F2' })).status).toBe(403);
    expect((await put(vo, { cobrar: 'F2' })).status).toBe(403);
    await put(ac, { cobrar: 'F2' });
    expect(keyOf((await get('/organizacion/atajos', acB)).body, 'cobrar')).toBe('NumpadAdd');
    const rows = await ownerSelect<{ tenant_id: string }>('SELECT tenant_id FROM atajos_comercio');
    expect(rows).toEqual([{ tenant_id: TENANT_A }]);
  });
});
