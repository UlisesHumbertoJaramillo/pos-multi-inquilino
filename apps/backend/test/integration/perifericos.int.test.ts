// Estado de los periféricos del POS en el panel técnico del SA (T-241; RF-016, RF-108, AD-16).
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerSelect } from '../support/database.js';
import { seedIdentity, signIn, TENANT_A, USERS } from '../support/identity-fixtures.js';

const api = createTestApi();
afterAll(() => api.close());

let vo: string;
let sa: string;

beforeEach(async () => {
  api.clock.set('2026-11-02T12:00:00Z');
  await seedIdentity();
  vo = (await signIn(api.app, USERS.vo.email, 'VO')).authorization;
  sa = (await signIn(api.app, USERS.sa.email)).authorization;
});

const report = (body: object, token = vo) =>
  request(api.app).post('/perifericos/estado').set('Authorization', token).send(body);
const panel = async () =>
  (await request(api.app).get('/plataforma/panel').set('Authorization', sa)).body as {
    perifericosConFalla: { comercioId: string; dispositivo: string; motivo: string | null }[];
  };

const failure = {
  dispositivo: 'impresora',
  conexion: 'usb',
  estado: 'falla',
  motivo: 'desconectada',
};

describe('[RF-016] [RF-108] estado de los periféricos (T-241)', () => {
  it('desconectar la impresora genera una alerta técnica visible para el SA', async () => {
    const response = await report(failure);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expectToMatchContract(response, 'post', '/perifericos/estado');
    expect(response.body).toEqual({ registrado: true });

    const shown = await request(api.app).get('/plataforma/panel').set('Authorization', sa);
    expectToMatchContract(shown, 'get', '/plataforma/panel');
    expect((shown.body as Awaited<ReturnType<typeof panel>>).perifericosConFalla).toEqual([
      expect.objectContaining({
        comercioId: TENANT_A,
        comercio: 'Comercio A',
        dispositivo: 'impresora',
        conexion: 'usb',
        motivo: 'desconectada',
      }),
    ]);
  });

  it('solo registra los cambios y la recuperación limpia el panel', async () => {
    await report(failure);
    api.clock.set('2026-11-02T12:01:00Z');
    expect((await report(failure)).body).toEqual({ registrado: false });
    api.clock.set('2026-11-02T12:02:00Z');
    expect((await report({ ...failure, estado: 'ok', motivo: null })).body).toEqual({
      registrado: true,
    });
    expect((await panel()).perifericosConFalla).toEqual([]);
    const events = await ownerSelect<{ detalle: Record<string, unknown> }>(
      "SELECT detalle FROM auditoria_tecnica WHERE tipo_evento = 'periferico' ORDER BY momento",
    );
    expect(events).toHaveLength(2);
    // Sin datos comerciales: solo el periférico, la conexión, el estado y un motivo cerrado.
    for (const e of events) {
      expect(Object.keys(e.detalle).sort()).toEqual([
        'conexion',
        'dispositivo',
        'estado',
        'motivo',
      ]);
    }
  });

  it('un estado correcto sin falla previa no se registra', async () => {
    expect(
      (await report({ dispositivo: 'lector', conexion: 'teclado', estado: 'ok' })).body,
    ).toEqual({ registrado: false });
  });

  it('el motivo es de una lista cerrada', async () => {
    const response = await report({ ...failure, motivo: 'la venta 15 de Juan' });
    expect(response.status).toBe(400);
  });
});
