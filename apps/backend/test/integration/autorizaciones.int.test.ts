// PIN, autorizaciones in situ, recurso de otro comercio y auditoría comercial
// (T-040, T-041, T-043, T-044, T-045).
import type { Authorization } from '@pos/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerQuery, ownerSelect, withAppClient } from '../support/database.js';
import {
  BRANCH_CENTRO,
  PIN,
  seedIdentity,
  signIn,
  TENANT_A,
  USERS,
} from '../support/identity-fixtures.js';

const api = createTestApi();
afterAll(() => api.close());

interface AuthorizeOptions {
  authorizerId?: string;
  pin?: string;
  branchId?: string;
  operationRef?: string;
}

async function authorizeAs(requesterEmail: string, options: AuthorizeOptions = {}) {
  const requester = await signIn(api.app, requesterEmail, 'VO');
  return request(api.app)
    .post('/autorizaciones')
    .set('Authorization', requester.authorization)
    .send({
      tipo: 'descuento',
      operacionRef: options.operationRef ?? 'venta-123',
      sucursalId: options.branchId ?? BRANCH_CENTRO,
      autorizanteId: options.authorizerId ?? USERS.asVo.id,
      pin: options.pin ?? PIN,
    });
}

describe('[RF-141] PIN de autorización', () => {
  beforeEach(seedIdentity);

  it('un AS fija su PIN y queda guardado solo como hash', async () => {
    const as = await signIn(api.app, USERS.asVo.email, 'AS');

    const response = await request(api.app)
      .put('/auth/pin')
      .set('Authorization', as.authorization)
      .send({ pin: '246813' });

    expect(response.status).toBe(204);
    const stored = await ownerSelect<{ hash_pin: string }>(
      'SELECT hash_pin FROM credencial_autorizacion WHERE usuario_id = $1',
      [USERS.asVo.id],
    );
    expect(stored[0]?.hash_pin).toMatch(/^\$argon2id\$/);
    expect(stored[0]?.hash_pin).not.toContain('246813');
  });

  it('un VO no puede fijar un PIN', async () => {
    const vo = await signIn(api.app, USERS.vo.email);

    const response = await request(api.app)
      .put('/auth/pin')
      .set('Authorization', vo.authorization)
      .send({ pin: '1111' });

    expect(response.status).toBe(403);
    expectToMatchContract(response, 'put', '/auth/pin');
  });

  it('el PIN tiene que tener entre 4 y 6 dígitos', async () => {
    const ac = await signIn(api.app, USERS.ac.email);

    const response = await request(api.app)
      .put('/auth/pin')
      .set('Authorization', ac.authorization)
      .send({ pin: '12a4' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'PIN_INVALIDO' });
  });
});

describe('[RF-113] [RF-141] autorización in situ', () => {
  beforeEach(seedIdentity);

  it('un AS de la sucursal autoriza con su PIN y la autorización queda ligada a la operación', async () => {
    const response = await authorizeAs(USERS.vo.email);

    expect(response.status).toBe(201);
    expectToMatchContract(response, 'post', '/autorizaciones');
    expect(response.body).toMatchObject({
      tipo: 'descuento',
      operacionRef: 'venta-123',
      sucursalId: BRANCH_CENTRO,
      solicitanteId: USERS.vo.id,
      autorizanteId: USERS.asVo.id,
      usada: false,
    });
  });

  it('un AC presente también puede autorizar', async () => {
    const response = await authorizeAs(USERS.vo.email, { authorizerId: USERS.ac.id });

    expect(response.status).toBe(201);
  });

  it('se rechaza la autoautorización, aunque el usuario tenga el rol AS', async () => {
    // asVo es VO de Centro y también AS de Centro: pide como VO e intenta autorizarse.
    const response = await authorizeAs(USERS.asVo.email, { authorizerId: USERS.asVo.id });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ codigo: 'AUTOAUTORIZACION' });
  });

  it('la base también impide que solicitante y autorizante sean la misma persona', async () => {
    await expect(
      ownerQuery(
        `INSERT INTO autorizacion (id, tenant_id, sucursal_id, tipo, operacion_ref, solicitante_id,
                                   autorizante_id, emitida_en)
         VALUES (gen_random_uuid(), $1, $2, 'descuento', 'x', $3, $3, now())`,
        [TENANT_A, BRANCH_CENTRO, USERS.vo.id],
      ),
    ).rejects.toMatchObject({ constraint: 'autorizacion_segregacion' });
  });

  it('un AS de otra sucursal no puede autorizar', async () => {
    const response = await authorizeAs(USERS.vo.email, { authorizerId: USERS.asNorte.id });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ codigo: 'AUTORIZANTE_NO_HABILITADO' });
  });

  it('un VO no puede autorizar', async () => {
    const response = await authorizeAs(USERS.asVo.email, { authorizerId: USERS.vo.id });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ codigo: 'AUTORIZANTE_NO_HABILITADO' });
  });

  it('un PIN erróneo se rechaza', async () => {
    const response = await authorizeAs(USERS.vo.email, { pin: '0000' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ codigo: 'PIN_INCORRECTO' });
  });

  it('la autorización se usa una sola vez y solo para su operación y su solicitante', async () => {
    const issued = (await authorizeAs(USERS.vo.email)).body as Authorization;
    const consume = (operationRef: string, requesterId: string) =>
      api.identity.useCases.consumeAuthorization.execute({
        id: issued.id,
        type: 'descuento',
        operationRef,
        requesterId,
      });
    const inTenant = <T>(work: () => Promise<T>) => api.db.run(work, { tenantId: TENANT_A });

    await expect(inTenant(() => consume('otra-venta', USERS.vo.id))).rejects.toMatchObject({
      code: 'AUTORIZACION_INVALIDA',
    });
    await expect(inTenant(() => consume('venta-123', USERS.asVo.id))).rejects.toMatchObject({
      code: 'AUTORIZACION_INVALIDA',
    });
    await inTenant(() => consume('venta-123', USERS.vo.id));
    await expect(inTenant(() => consume('venta-123', USERS.vo.id))).rejects.toMatchObject({
      code: 'AUTORIZACION_INVALIDA',
    });
  });
});

describe('[RF-145] bloqueo del PIN', () => {
  beforeEach(seedIdentity);

  it('el sexto PIN erróneo queda bloqueado y el bloqueo se audita', async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await authorizeAs(USERS.vo.email, { pin: '0000' })).status).toBe(403);
    }

    const sixth = await authorizeAs(USERS.vo.email);
    expect(sixth.status).toBe(423);
    expectToMatchContract(sixth, 'post', '/autorizaciones');
    expect(sixth.body).toMatchObject({ codigo: 'CREDENCIAL_BLOQUEADA' });

    const audit = await ownerSelect<{ actor_id: string; detalle: { credential: string } }>(
      "SELECT actor_id, detalle FROM auditoria_tecnica WHERE tipo_evento = 'credencial_bloqueada'",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: USERS.asVo.id, detalle: { credential: 'pin' } });

    api.clock.advance(15 * 60_000);
    expect((await authorizeAs(USERS.vo.email)).status).toBe(201);
  });
});

describe('[RF-002] recurso de otro comercio', () => {
  beforeEach(seedIdentity);

  it('se responde como inexistente y el intento queda en la auditoría técnica', async () => {
    const issued = (await authorizeAs(USERS.vo.email)).body as Authorization;
    const other = await signIn(api.app, USERS.voB.email);

    const response = await request(api.app)
      .get(`/autorizaciones/${issued.id}`)
      .set('Authorization', other.authorization);
    const missing = await request(api.app)
      .get('/autorizaciones/00000000-0000-4000-8000-000000000000')
      .set('Authorization', other.authorization);

    expect(response.status).toBe(404);
    expectToMatchContract(response, 'get', '/autorizaciones/{id}');
    expect(response.body).toStrictEqual(missing.body);
    const audit = await ownerSelect<{ actor_id: string; detalle: { resourceId: string } }>(
      "SELECT actor_id, detalle FROM auditoria_tecnica WHERE tipo_evento = 'acceso_otro_comercio'",
    );
    expect(audit).toStrictEqual([
      {
        actor_id: USERS.voB.id,
        detalle: { resourceType: 'autorizacion', resourceId: issued.id },
      },
    ]);
  });

  it('el mismo comercio sí la ve', async () => {
    const issued = (await authorizeAs(USERS.vo.email)).body as Authorization;
    const ac = await signIn(api.app, USERS.ac.email);

    const response = await request(api.app)
      .get(`/autorizaciones/${issued.id}`)
      .set('Authorization', ac.authorization);

    expect(response.status).toBe(200);
    expectToMatchContract(response, 'get', '/autorizaciones/{id}');
  });
});

describe('[RF-018] [RF-019] auditoría comercial', () => {
  beforeEach(seedIdentity);

  it('la autorización por PIN queda registrada con quién, cuándo y sobre qué', async () => {
    const issued = (await authorizeAs(USERS.vo.email)).body as Authorization;

    const audit = await ownerSelect(
      `SELECT tenant_id, sucursal_id, usuario_id, rol_activo, accion, entidad, entidad_id,
              estado_posterior, autorizacion_id
         FROM auditoria_comercial`,
    );
    expect(audit).toStrictEqual([
      {
        tenant_id: TENANT_A,
        sucursal_id: BRANCH_CENTRO,
        usuario_id: USERS.asVo.id,
        rol_activo: 'AS',
        accion: 'autorizacion_pin',
        entidad: 'autorizacion',
        entidad_id: issued.id,
        estado_posterior: {
          tipo: 'descuento',
          operacionRef: 'venta-123',
          solicitanteId: USERS.vo.id,
        },
        autorizacion_id: issued.id,
      },
    ]);
  });

  it('la aplicación no puede modificar ni borrar la auditoría', async () => {
    await authorizeAs(USERS.vo.email);

    for (const sql of [
      "UPDATE auditoria_comercial SET accion = 'otra'",
      'DELETE FROM auditoria_comercial',
    ]) {
      await expect(
        withAppClient(async (client) => {
          await client.query("SELECT set_config('app.tenant_id', $1, false)", [TENANT_A]);
          return client.query(sql);
        }),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('se revierte junto con su transacción', async () => {
    const db = api.db;
    const attempt = db.run(
      async () => {
        await db.query(
          `INSERT INTO auditoria_comercial (id, tenant_id, usuario_id, rol_activo, momento, accion,
                                            entidad, entidad_id)
           VALUES (gen_random_uuid(), $1, $2, 'AS', now(), 'prueba', 'x', '1')`,
          [TENANT_A, USERS.asVo.id],
        );
        throw new Error('falla la operación');
      },
      { tenantId: TENANT_A },
    );

    await expect(attempt).rejects.toThrow('falla la operación');
    expect(await ownerSelect('SELECT 1 FROM auditoria_comercial')).toHaveLength(0);
  });
});
