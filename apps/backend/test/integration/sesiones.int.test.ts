// Renovación, cierre, inactividad, contexto de seguridad y rol activo (T-032, T-033, T-035, T-036).
import type { ActiveRoleChange, SessionTokens, SessionUser } from '@pos/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerSelect } from '../support/database.js';
import {
  BRANCH_CENTRO,
  BRANCH_NORTE,
  PASSWORD,
  seedIdentity,
  signIn,
  TENANT_A,
  TENANT_B,
  USERS,
} from '../support/identity-fixtures.js';

const api = createTestApi();
afterAll(() => api.close());

const refresh = (token: string) =>
  request(api.app).post('/auth/renovar').send({ tokenRenovacion: token });

describe('[RF-009] renovación, cierre y revocación de la sesión', () => {
  beforeEach(seedIdentity);

  it('la renovación rota el token y emite un token de acceso nuevo', async () => {
    const { refreshToken } = await signIn(api.app, USERS.vo.email);

    const first = await refresh(refreshToken);

    expect(first.status).toBe(200);
    expectToMatchContract(first, 'post', '/auth/renovar');
    const body = first.body as SessionTokens;
    expect(body.tokenRenovacion).not.toBe(refreshToken);
    expect((await refresh(body.tokenRenovacion)).status).toBe(200);
  });

  it('un token de renovación revocado al cerrar sesión responde 401', async () => {
    const { authorization, refreshToken } = await signIn(api.app, USERS.vo.email);

    const logout = await request(api.app)
      .post('/auth/cerrar-sesion')
      .set('Authorization', authorization);
    expect(logout.status).toBe(204);

    const response = await refresh(refreshToken);
    expect(response.status).toBe(401);
    expectToMatchContract(response, 'post', '/auth/renovar');
    expect(response.body).toMatchObject({ codigo: 'SESION_INVALIDA' });
  });

  it('reutilizar un token ya rotado revoca toda la sesión y queda auditado', async () => {
    const { refreshToken } = await signIn(api.app, USERS.vo.email);
    const rotated = (await refresh(refreshToken)).body as SessionTokens;

    expect((await refresh(refreshToken)).status).toBe(401);
    // El token legítimo más nuevo también quedó revocado: la sesión se considera robada.
    expect((await refresh(rotated.tokenRenovacion)).status).toBe(401);
    const audit = await ownerSelect('SELECT 1 FROM auditoria_tecnica WHERE tipo_evento = $1', [
      'token_renovacion_reutilizado',
    ]);
    expect(audit).toHaveLength(1);
  });

  it('la renovación falla tras la inactividad configurada, sin tocar otras sesiones', async () => {
    const idle = await signIn(api.app, USERS.vo.email);
    api.clock.advance(20 * 60_000);
    const active = await signIn(api.app, USERS.vo.email);
    api.clock.advance(11 * 60_000);

    expect((await refresh(idle.refreshToken)).status).toBe(401);
    expect((await refresh(active.refreshToken)).status).toBe(200);
  });

  it('cada renovación cuenta como actividad', async () => {
    let { refreshToken } = await signIn(api.app, USERS.vo.email);
    for (let i = 0; i < 3; i++) {
      api.clock.advance(25 * 60_000);
      const response = await refresh(refreshToken);
      expect(response.status).toBe(200);
      refreshToken = (response.body as SessionTokens).tokenRenovacion;
    }
  });

  it('un token de acceso vencido responde 401', async () => {
    const { authorization } = await signIn(api.app, USERS.vo.email);
    api.clock.advance(6 * 60_000);

    const response = await request(api.app).get('/auth/sesion').set('Authorization', authorization);

    expect(response.status).toBe(401);
  });
});

describe('[RF-001] contexto de seguridad', () => {
  beforeEach(seedIdentity);

  it('[RF-178] la sesión trae el nombre del comercio y solo las sucursales del rol activo', async () => {
    const asNorte = await signIn(api.app, USERS.asNorte.email);
    const session = await request(api.app)
      .get('/auth/sesion')
      .set('Authorization', asNorte.authorization);
    expectToMatchContract(session, 'get', '/auth/sesion');
    expect(session.body).toMatchObject({
      nombreComercio: 'Comercio A',
      detalleSucursales: [{ id: BRANCH_NORTE, nombre: 'Norte' }],
    });

    const sa = await signIn(api.app, USERS.sa.email);
    const platform = await request(api.app)
      .get('/auth/sesion')
      .set('Authorization', sa.authorization);
    expect(platform.body).toMatchObject({ nombreComercio: null, detalleSucursales: [] });
  });

  it('el comercio sale del token: un tenant_id enviado como parámetro o en el cuerpo se ignora', async () => {
    const { authorization } = await signIn(api.app, USERS.vo.email);

    const response = await request(api.app)
      .get(`/auth/sesion?tenant_id=${TENANT_B}&comercioId=${TENANT_B}`)
      .set('Authorization', authorization)
      .set('X-Tenant-Id', TENANT_B)
      .send({ tenant_id: TENANT_B });

    expect(response.status).toBe(200);
    expectToMatchContract(response, 'get', '/auth/sesion');
    expect((response.body as SessionUser).comercioId).toBe(TENANT_A);
  });

  it('un token alterado se rechaza', async () => {
    const { authorization } = await signIn(api.app, USERS.vo.email);
    const [header, payload, signature] = authorization.replace('Bearer ', '').split('.');
    const forged = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as Record<
      string,
      unknown
    >;
    forged.tid = TENANT_B;
    const tampered = `${header ?? ''}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${signature ?? ''}`;

    const response = await request(api.app)
      .get('/auth/sesion')
      .set('Authorization', `Bearer ${tampered}`);

    expect(response.status).toBe(401);
  });
});

describe('[RF-005] [RF-010] [RF-011] rol activo', () => {
  beforeEach(seedIdentity);

  it('en el primer ingreso con varios roles pide elegir, y el elegido se recuerda', async () => {
    const first = await request(api.app)
      .post('/auth/login')
      .send({ email: USERS.asVo.email, contrasena: PASSWORD });
    const session = first.body as SessionTokens;
    expect(session.requiereElegirRol).toBe(true);
    expect(session.usuario.rolActivo).toBeNull();

    const choose = await request(api.app)
      .put('/auth/rol-activo')
      .set('Authorization', `Bearer ${session.tokenAcceso}`)
      .send({ rol: 'AS' });
    expect(choose.status).toBe(200);
    expectToMatchContract(choose, 'put', '/auth/rol-activo');
    expect((choose.body as ActiveRoleChange).usuario).toMatchObject({
      rolActivo: 'AS',
      sucursales: [BRANCH_CENTRO, BRANCH_NORTE],
    });

    const next = await signIn(api.app, USERS.asVo.email);
    expect(next.session.usuario.rolActivo).toBe('AS');
    expect(next.session.requiereElegirRol).toBe(false);
  });

  it('al cambiar de rol, una acción del rol anterior se rechaza de inmediato', async () => {
    const asAs = await signIn(api.app, USERS.asVo.email, 'AS');
    const setPin = (authorization: string) =>
      request(api.app).put('/auth/pin').set('Authorization', authorization).send({ pin: '9876' });
    expect((await setPin(asAs.authorization)).status).toBe(204);

    const change = await request(api.app)
      .put('/auth/rol-activo')
      .set('Authorization', asAs.authorization)
      .send({ rol: 'VO' });
    const asVo = `Bearer ${(change.body as ActiveRoleChange).tokenAcceso}`;

    const denied = await setPin(asVo);
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ codigo: 'SIN_PERMISO' });
  });

  it('el cambio de rol no cierra la sesión: la renovación sigue con el rol nuevo', async () => {
    const asAs = await signIn(api.app, USERS.asVo.email, 'AS');
    await request(api.app)
      .put('/auth/rol-activo')
      .set('Authorization', asAs.authorization)
      .send({ rol: 'VO' });

    const renewed = await refresh(asAs.refreshToken);

    expect(renewed.status).toBe(200);
    expect((renewed.body as SessionTokens).usuario).toMatchObject({
      rolActivo: 'VO',
      sucursales: [BRANCH_CENTRO],
    });
  });

  it('no se puede activar un rol que no está asignado', async () => {
    const { authorization } = await signIn(api.app, USERS.vo.email);

    const response = await request(api.app)
      .put('/auth/rol-activo')
      .set('Authorization', authorization)
      .send({ rol: 'AC' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ codigo: 'ROL_NO_ASIGNADO' });
  });
});
