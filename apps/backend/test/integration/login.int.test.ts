// Inicio de sesión, correo sin validar, bloqueo y límite de frecuencia (T-027, T-028, T-034).
import type { SessionTokens } from '@pos/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerSelect } from '../support/database.js';
import {
  BRANCH_CENTRO,
  PASSWORD,
  seedIdentity,
  TENANT_A,
  USERS,
} from '../support/identity-fixtures.js';

const api = createTestApi();
afterAll(() => api.close());

function login(email: string, contrasena = PASSWORD) {
  return request(api.app).post('/auth/login').send({ email, contrasena });
}

async function technicalAudit(type: string) {
  return ownerSelect<{ actor_id: string | null }>(
    'SELECT actor_id FROM auditoria_tecnica WHERE tipo_evento = $1',
    [type],
  );
}

describe('[RF-005] inicio de sesión', () => {
  beforeEach(seedIdentity);

  it('con el VO demo devuelve el token de acceso, el de renovación y su rol activo', async () => {
    const response = await login(USERS.vo.email);

    expect(response.status).toBe(200);
    expectToMatchContract(response, 'post', '/auth/login');
    const body = response.body as SessionTokens;
    expect(body.tokenAcceso.split('.')).toHaveLength(3);
    expect(body.tokenRenovacion.length).toBeGreaterThan(30);
    expect(body.usuario).toMatchObject({
      email: USERS.vo.email,
      comercioId: TENANT_A,
      roles: ['VO'],
      rolActivo: 'VO',
      sucursales: [BRANCH_CENTRO],
    });
    expect(body.requiereElegirRol).toBe(false);
    expect(await technicalAudit('login_exitoso')).toStrictEqual([{ actor_id: USERS.vo.id }]);
  });

  it('el token de renovación se guarda solo como hash', async () => {
    const body = (await login(USERS.vo.email)).body as SessionTokens;

    const stored = await ownerSelect<{ hash_token: string }>(
      'SELECT hash_token FROM token_renovacion',
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]?.hash_token).not.toBe(body.tokenRenovacion);
  });

  it('ignora mayúsculas y espacios en el correo', async () => {
    expect((await login(`  ${USERS.vo.email.toUpperCase()} `)).status).toBe(200);
  });

  it('una contraseña errónea responde 401 con un mensaje genérico', async () => {
    const response = await login(USERS.vo.email, 'Otra-contraseña-1');

    expect(response.status).toBe(401);
    expectToMatchContract(response, 'post', '/auth/login');
    expect(response.body).toStrictEqual({
      codigo: 'CREDENCIALES_INVALIDAS',
      mensaje: 'El correo o la contraseña no son correctos.',
    });
    expect(await technicalAudit('login_fallido')).toHaveLength(1);
  });

  it('un correo inexistente responde exactamente lo mismo que una contraseña errónea', async () => {
    const unknown = await login('nadie@prueba.local');
    const wrong = await login(USERS.vo.email, 'Otra-contraseña-1');

    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body).toStrictEqual(wrong.body);
  });
});

describe('[RF-006] correo sin validar', () => {
  beforeEach(seedIdentity);

  it('deniega el acceso e indica que falta la validación', async () => {
    const response = await login(USERS.pendiente.email);

    expect(response.status).toBe(403);
    expectToMatchContract(response, 'post', '/auth/login');
    expect(response.body).toMatchObject({ codigo: 'CORREO_SIN_VALIDAR' });
    expect((response.body as { mensaje: string }).mensaje).toContain('nuevo correo de validación');
  });

  it('con una contraseña errónea no revela que falta la validación', async () => {
    const response = await login(USERS.pendiente.email, 'Otra-contraseña-1');

    expect(response.status).toBe(401);
  });
});

describe('[RF-145] bloqueo de la contraseña', () => {
  beforeEach(seedIdentity);

  it('el sexto intento responde "bloqueado" y, pasados 15 minutos, se puede ingresar', async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await login(USERS.vo.email, 'Mala-contraseña-1')).status).toBe(401);
    }

    const sixth = await login(USERS.vo.email);
    expect(sixth.status).toBe(423);
    expectToMatchContract(sixth, 'post', '/auth/login');
    expect(sixth.body).toMatchObject({ codigo: 'CREDENCIAL_BLOQUEADA' });

    api.clock.advance(14 * 60_000);
    expect((await login(USERS.vo.email)).status).toBe(423);

    api.clock.advance(60_000);
    expect((await login(USERS.vo.email)).status).toBe(200);
  });

  it('el bloqueo queda en la auditoría técnica', async () => {
    for (let attempt = 1; attempt <= 5; attempt++) await login(USERS.vo.email, 'Mala-contraseña-1');

    expect(await technicalAudit('credencial_bloqueada')).toStrictEqual([{ actor_id: USERS.vo.id }]);
  });

  it('un ingreso correcto reinicia la cuenta de fallos', async () => {
    for (let attempt = 1; attempt <= 4; attempt++) await login(USERS.vo.email, 'Mala-contraseña-1');
    expect((await login(USERS.vo.email)).status).toBe(200);
    for (let attempt = 1; attempt <= 4; attempt++) await login(USERS.vo.email, 'Mala-contraseña-1');

    expect((await login(USERS.vo.email)).status).toBe(200);
  });

  it('un correo inexistente también se bloquea, sin revelar que no existe', async () => {
    for (let attempt = 1; attempt <= 5; attempt++)
      await login('nadie@prueba.local', 'x'.repeat(12));

    expect((await login('nadie@prueba.local', 'x'.repeat(12))).status).toBe(423);
  });
});

describe('límite de frecuencia de los endpoints públicos', () => {
  const limited = createTestApi({ publicRateLimit: 3 });
  beforeEach(seedIdentity);
  afterAll(() => limited.close());

  it('responde 429 con el error uniforme al superar el límite', async () => {
    const send = () =>
      request(limited.app).post('/auth/recuperacion/solicitar').send({ email: USERS.vo.email });
    for (let i = 0; i < 3; i++) expect((await send()).status).toBe(202);

    const response = await send();

    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({ codigo: 'DEMASIADAS_SOLICITUDES' });
  });
});
