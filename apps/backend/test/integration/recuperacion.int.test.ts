// Validación de correo y recuperación de contraseña (T-029, T-030).
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { PASSWORD, seedIdentity, signIn, USERS } from '../support/identity-fixtures.js';

const api = createTestApi();
afterAll(() => api.close());
beforeEach(() => {
  api.email.clear();
});

const post = (path: string, body: object) => request(api.app).post(path).send(body);
const login = (email: string, contrasena: string) => post('/auth/login', { email, contrasena });

describe('[RF-006] validación de correo', () => {
  beforeEach(seedIdentity);

  it('el reenvío manda un correo con un enlace que valida la cuenta una sola vez', async () => {
    const resend = await post('/auth/validacion/reenviar', { email: USERS.pendiente.email });
    expect(resend.status).toBe(202);
    expectToMatchContract(resend, 'post', '/auth/validacion/reenviar');

    const message = api.email.sent.at(-1);
    expect(message?.to).toBe(USERS.pendiente.email);
    expect(message?.text).toContain('https://localhost:5173/validar-correo?token=');
    const token = api.email.lastTokenFor(USERS.pendiente.email);

    const confirm = await post('/auth/validacion/confirmar', { token });
    expect(confirm.status).toBe(200);
    expectToMatchContract(confirm, 'post', '/auth/validacion/confirmar');
    expect((await login(USERS.pendiente.email, PASSWORD)).status).toBe(200);

    const again = await post('/auth/validacion/confirmar', { token });
    expect(again.status).toBe(400);
    expect(again.body).toMatchObject({ codigo: 'TOKEN_INVALIDO' });
  });

  it('un correo nuevo deja sin efecto el enlace anterior', async () => {
    await post('/auth/validacion/reenviar', { email: USERS.pendiente.email });
    const first = api.email.lastTokenFor(USERS.pendiente.email);
    await post('/auth/validacion/reenviar', { email: USERS.pendiente.email });

    expect((await post('/auth/validacion/confirmar', { token: first })).status).toBe(400);
  });

  it('responde lo mismo para un correo inexistente o ya validado, sin enviar nada', async () => {
    const unknown = await post('/auth/validacion/reenviar', { email: 'nadie@prueba.local' });
    const validated = await post('/auth/validacion/reenviar', { email: USERS.vo.email });

    expect(unknown.status).toBe(202);
    expect(unknown.body).toStrictEqual(validated.body);
    expect(api.email.sent).toHaveLength(0);
  });
});

describe('[RF-007] [RF-008] recuperación de contraseña', () => {
  beforeEach(seedIdentity);

  async function requestReset(email: string): Promise<string> {
    await post('/auth/recuperacion/solicitar', { email });
    return api.email.lastTokenFor(email);
  }

  it('responde lo mismo exista o no la cuenta, y solo envía el correo si existe', async () => {
    const existing = await post('/auth/recuperacion/solicitar', { email: USERS.vo.email });
    const unknown = await post('/auth/recuperacion/solicitar', { email: 'nadie@prueba.local' });

    expect(existing.status).toBe(202);
    expectToMatchContract(existing, 'post', '/auth/recuperacion/solicitar');
    expect(unknown.status).toBe(existing.status);
    expect(unknown.body).toStrictEqual(existing.body);
    expect(api.email.sent.map((m) => m.to)).toStrictEqual([USERS.vo.email]);
    expect(api.email.sent[0]?.text).toContain('/restablecer-contrasena?token=');
  });

  it('restablece la contraseña con el token del correo', async () => {
    const token = await requestReset(USERS.vo.email);

    const reset = await post('/auth/recuperacion/restablecer', {
      token,
      nuevaContrasena: 'Nueva-clave-segura-2',
    });

    expect(reset.status).toBe(200);
    expectToMatchContract(reset, 'post', '/auth/recuperacion/restablecer');
    expect((await login(USERS.vo.email, 'Nueva-clave-segura-2')).status).toBe(200);
    expect((await login(USERS.vo.email, PASSWORD)).status).toBe(401);
  });

  it('rechaza un token ya usado', async () => {
    const token = await requestReset(USERS.vo.email);
    await post('/auth/recuperacion/restablecer', {
      token,
      nuevaContrasena: 'Nueva-clave-segura-2',
    });

    const again = await post('/auth/recuperacion/restablecer', {
      token,
      nuevaContrasena: 'Otra-clave-segura-3',
    });

    expect(again.status).toBe(400);
    expect(again.body).toMatchObject({ codigo: 'TOKEN_INVALIDO' });
  });

  it('rechaza un token vencido', async () => {
    const token = await requestReset(USERS.vo.email);
    api.clock.advance(61 * 60_000);

    const reset = await post('/auth/recuperacion/restablecer', {
      token,
      nuevaContrasena: 'Nueva-clave-segura-2',
    });

    expect(reset.status).toBe(400);
    expect((await login(USERS.vo.email, PASSWORD)).status).toBe(200);
  });

  it('rechaza una contraseña nueva demasiado corta, sin gastar el token', async () => {
    const token = await requestReset(USERS.vo.email);

    const short = await post('/auth/recuperacion/restablecer', { token, nuevaContrasena: 'corta' });
    const ok = await post('/auth/recuperacion/restablecer', {
      token,
      nuevaContrasena: 'Nueva-clave-segura-2',
    });

    expect(short.status).toBe(409);
    expect(short.body).toMatchObject({ codigo: 'CONTRASENA_INVALIDA' });
    expect(ok.status).toBe(200);
  });

  it('al restablecer se cierran todas las sesiones abiertas', async () => {
    const { refreshToken } = await signIn(api.app, USERS.vo.email);
    const token = await requestReset(USERS.vo.email);
    await post('/auth/recuperacion/restablecer', {
      token,
      nuevaContrasena: 'Nueva-clave-segura-2',
    });

    const refresh = await post('/auth/renovar', { tokenRenovacion: refreshToken });

    expect(refresh.status).toBe(401);
  });
});
