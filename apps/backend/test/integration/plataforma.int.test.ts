// Plataforma del Super Administrador (T-049 a T-057).
import type {
  CreatedAccount,
  TechnicalAuditEntry,
  TechnicalPanel,
  Tenant,
  TicketDetail,
  TicketSummary,
} from '@pos/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FiscalPending } from '../../src/modulos/plataforma/dominio/tenant.js';
import { createTestApi, type TestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerQuery, ownerSelect } from '../support/database.js';
import { seedIdentity, signIn, TENANT_A, USERS } from '../support/identity-fixtures.js';

// Pendientes fiscales simulados: cada prueba decide qué devuelve el puerto (T-053).
let pending: FiscalPending = { queued: 0, rejected: 0, caeaNotReported: 0 };
const api: TestApi = createTestApi({
  fiscalPending: { pendingFor: () => Promise.resolve(pending) },
  extraRoutes: [
    {
      method: 'get',
      path: '/prueba/error-forzado',
      handler: () => {
        throw new Error('fallo forzado de prueba');
      },
    },
  ],
});
afterAll(() => api.close());

const NEW_TENANT = {
  nombre: 'Almacén Don Pepe',
  cuit: '30-71234567-1',
  moneda: 'ARS',
  zonaHoraria: 'America/Argentina/Cordoba',
};

async function asSa() {
  return (await signIn(api.app, USERS.sa.email)).authorization;
}

async function createTenant(authorization: string): Promise<Tenant> {
  const response = await request(api.app)
    .post('/plataforma/comercios')
    .set('Authorization', authorization)
    .send(NEW_TENANT);
  expect(response.status).toBe(201);
  return response.body as Tenant;
}

beforeEach(async () => {
  pending = { queued: 0, rejected: 0, caeaNotReported: 0 };
  api.email.clear();
  await seedIdentity();
});

describe('[RF-013] alta y modificación de comercios', () => {
  it('el SA da de alta un comercio y el alta queda en la auditoría técnica', async () => {
    const sa = await asSa();

    const response = await request(api.app)
      .post('/plataforma/comercios')
      .set('Authorization', sa)
      .send(NEW_TENANT);

    expect(response.status).toBe(201);
    expectToMatchContract(response, 'post', '/plataforma/comercios');
    expect(response.body).toMatchObject({
      nombre: 'Almacén Don Pepe',
      cuit: '30-71234567-1',
      moneda: 'ARS',
      estado: 'activo',
      moduloFacturacion: false,
    });
    const audit = await ownerSelect<{ actor_id: string; tenant_id: string }>(
      "SELECT actor_id, tenant_id FROM auditoria_tecnica WHERE tipo_evento = 'comercio_alta'",
    );
    expect(audit).toStrictEqual([
      { actor_id: USERS.sa.id, tenant_id: (response.body as Tenant).id },
    ]);
  });

  it('valida la moneda, la zona horaria y el CUIT', async () => {
    const sa = await asSa();
    for (const invalid of [
      { ...NEW_TENANT, moneda: 'ars' },
      { ...NEW_TENANT, zonaHoraria: 'Marte/Olympus' },
      { ...NEW_TENANT, cuit: '30-71234567-8' },
    ]) {
      const response = await request(api.app)
        .post('/plataforma/comercios')
        .set('Authorization', sa)
        .send(invalid);
      expect(response.status).toBe(409);
    }
  });

  it('el SA lista y modifica comercios', async () => {
    const sa = await asSa();
    const tenant = await createTenant(sa);

    const list = await request(api.app).get('/plataforma/comercios').set('Authorization', sa);
    const patch = await request(api.app)
      .patch(`/plataforma/comercios/${tenant.id}`)
      .set('Authorization', sa)
      .send({ nombre: 'Almacén Pepe', moneda: 'USD' });

    expectToMatchContract(list, 'get', '/plataforma/comercios');
    expect((list.body as Tenant[]).map((t) => t.nombre)).toContain('Almacén Don Pepe');
    expectToMatchContract(patch, 'patch', '/plataforma/comercios/{id}');
    expect(patch.body).toMatchObject({ nombre: 'Almacén Pepe', moneda: 'USD' });
  });
});

describe('[RF-134] la moneda no cambia con operaciones', () => {
  it('cambiar la moneda de un comercio con operaciones se rechaza', async () => {
    const sa = await asSa();
    await ownerQuery('UPDATE comercio SET tiene_operaciones = true WHERE id = $1', [TENANT_A]);

    const response = await request(api.app)
      .patch(`/plataforma/comercios/${TENANT_A}`)
      .set('Authorization', sa)
      .send({ moneda: 'USD' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'MONEDA_BLOQUEADA' });
  });

  it('la base también lo impide, aunque se saltee el dominio', async () => {
    await ownerQuery('UPDATE comercio SET tiene_operaciones = true WHERE id = $1', [TENANT_A]);

    await expect(
      ownerQuery("UPDATE comercio SET moneda = 'USD' WHERE id = $1", [TENANT_A]),
    ).rejects.toMatchObject({ constraint: 'comercio_moneda_bloqueada' });
  });
});

describe('[RF-015] cuentas creadas por el SA', () => {
  it('crea el primer AC de un comercio y su correo de activación aparece en la consola', async () => {
    const sa = await asSa();
    const tenant = await createTenant(sa);

    const response = await request(api.app)
      .post(`/plataforma/comercios/${tenant.id}/administrador`)
      .set('Authorization', sa)
      .send({ email: 'Duenio@Pepe.local', nombre: 'José Pepe' });

    expect(response.status).toBe(201);
    expectToMatchContract(response, 'post', '/plataforma/comercios/{id}/administrador');
    expect((response.body as CreatedAccount).email).toBe('duenio@pepe.local');
    const message = api.email.sent.at(-1);
    expect(message?.subject).toBe('Activá tu cuenta');
    expect(message?.text).toContain('https://localhost:5173/activar-cuenta?token=');
  });

  it('el AC activa su cuenta eligiendo la contraseña, y recién entonces puede ingresar', async () => {
    const sa = await asSa();
    const tenant = await createTenant(sa);
    await request(api.app)
      .post(`/plataforma/comercios/${tenant.id}/administrador`)
      .set('Authorization', sa)
      .send({ email: 'duenio@pepe.local', nombre: 'José Pepe' });
    const login = () =>
      request(api.app)
        .post('/auth/login')
        .send({ email: 'duenio@pepe.local', contrasena: 'Clave-del-duenio-1' });
    expect((await login()).status).toBe(401);

    const activation = await request(api.app)
      .post('/auth/activacion')
      .send({
        token: api.email.lastTokenFor('duenio@pepe.local'),
        nuevaContrasena: 'Clave-del-duenio-1',
      });

    expect(activation.status).toBe(200);
    expectToMatchContract(activation, 'post', '/auth/activacion');
    const session = await login();
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({ usuario: { rolActivo: 'AC', comercioId: tenant.id } });
  });

  it('solo el primer AC: si el comercio ya tiene uno, se rechaza', async () => {
    const response = await request(api.app)
      .post(`/plataforma/comercios/${TENANT_A}/administrador`)
      .set('Authorization', await asSa())
      .send({ email: 'otro@prueba.local', nombre: 'Otro' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'YA_TIENE_ADMINISTRADOR' });
  });

  it('crea otro SA, también con activación por correo', async () => {
    const response = await request(api.app)
      .post('/plataforma/administradores')
      .set('Authorization', await asSa())
      .send({ email: 'sa2@prueba.local', nombre: 'Segundo SA' });

    expect(response.status).toBe(201);
    expectToMatchContract(response, 'post', '/plataforma/administradores');
    expect(api.email.sent.at(-1)?.to).toBe('sa2@prueba.local');
  });

  it('un correo ya usado se rechaza', async () => {
    const response = await request(api.app)
      .post('/plataforma/administradores')
      .set('Authorization', await asSa())
      .send({ email: USERS.vo.email, nombre: 'Repetido' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'CORREO_EN_USO' });
  });
});

describe('[RF-014] [RF-146] suspensión de comercios', () => {
  it('el VO del comercio suspendido recibe 401 en su siguiente solicitud', async () => {
    const vo = await signIn(api.app, USERS.vo.email);
    const session = () =>
      request(api.app).get('/auth/sesion').set('Authorization', vo.authorization);
    expect((await session()).status).toBe(200);

    const suspend = await request(api.app)
      .post(`/plataforma/comercios/${TENANT_A}/suspension`)
      .set('Authorization', await asSa());

    expect(suspend.status).toBe(200);
    expectToMatchContract(suspend, 'post', '/plataforma/comercios/{id}/suspension');
    expect((await session()).status).toBe(401);
    expect(
      (await request(api.app).post('/auth/renovar').send({ tokenRenovacion: vo.refreshToken }))
        .status,
    ).toBe(401);
    // Mientras está suspendido, sus usuarios no ingresan.
    const login = await request(api.app)
      .post('/auth/login')
      .send({ email: USERS.vo.email, contrasena: 'Clave-de-prueba-1' });
    expect(login.body).toMatchObject({ codigo: 'COMERCIO_NO_DISPONIBLE' });
  });

  it('publica el evento de suspensión y no afecta a otros comercios', async () => {
    const otherVo = await signIn(api.app, USERS.voB.email);

    await request(api.app)
      .post(`/plataforma/comercios/${TENANT_A}/suspension`)
      .set('Authorization', await asSa());

    const events = await ownerSelect<{ tipo_evento: string; tenant_id: string }>(
      'SELECT tipo_evento, tenant_id FROM outbox',
    );
    expect(events).toStrictEqual([{ tipo_evento: 'comercio.suspendido', tenant_id: TENANT_A }]);
    expect(
      (await request(api.app).get('/auth/sesion').set('Authorization', otherVo.authorization))
        .status,
    ).toBe(200);
  });

  it('al reactivarlo, sus usuarios vuelven a ingresar', async () => {
    const sa = await asSa();
    await request(api.app)
      .post(`/plataforma/comercios/${TENANT_A}/suspension`)
      .set('Authorization', sa);

    const reactivate = await request(api.app)
      .post(`/plataforma/comercios/${TENANT_A}/reactivacion`)
      .set('Authorization', sa);

    expect(reactivate.body).toMatchObject({ estado: 'activo' });
    expect((await signIn(api.app, USERS.vo.email)).session.usuario.comercioId).toBe(TENANT_A);
  });
});

describe('[RF-147] baja de comercios', () => {
  it('sin comprobantes pendientes, el comercio queda dado de baja y sus datos se conservan', async () => {
    const response = await request(api.app)
      .post(`/plataforma/comercios/${TENANT_A}/baja`)
      .set('Authorization', await asSa());

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ estado: 'baja' });
    const row = await ownerSelect<{ estado: string; dado_de_baja_por: string }>(
      'SELECT estado, dado_de_baja_por FROM comercio WHERE id = $1',
      [TENANT_A],
    );
    expect(row).toStrictEqual([{ estado: 'baja', dado_de_baja_por: USERS.sa.id }]);
    expect(
      await ownerSelect('SELECT 1 FROM usuario WHERE tenant_id = $1', [TENANT_A]),
    ).not.toHaveLength(0);
  });

  it('con comprobantes pendientes se rechaza e indica cuáles la impiden', async () => {
    pending = { queued: 1, rejected: 0, caeaNotReported: 2 };

    const response = await request(api.app)
      .post(`/plataforma/comercios/${TENANT_A}/baja`)
      .set('Authorization', await asSa());

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'COMPROBANTES_PENDIENTES' });
    expect((response.body as { mensaje: string }).mensaje).toContain(
      '1 en cola, 2 emitido(s) con CAEA sin informar',
    );
  });
});

describe('[RF-163] [RF-164] módulo de facturación', () => {
  const setModule = async (activo: boolean) =>
    request(api.app)
      .put(`/plataforma/comercios/${TENANT_A}/modulo-facturacion`)
      .set('Authorization', await asSa())
      .send({ activo });

  it('el SA lo activa y lo desactiva, y queda registrado quién lo cambió', async () => {
    const on = await setModule(true);
    expect(on.status).toBe(200);
    expectToMatchContract(on, 'put', '/plataforma/comercios/{id}/modulo-facturacion');
    expect(on.body).toMatchObject({ moduloFacturacion: true });

    expect((await setModule(false)).body).toMatchObject({ moduloFacturacion: false });
    const row = await ownerSelect<{ modulo_facturacion_cambiado_por: string }>(
      'SELECT modulo_facturacion_cambiado_por FROM comercio WHERE id = $1',
      [TENANT_A],
    );
    expect(row[0]?.modulo_facturacion_cambiado_por).toBe(USERS.sa.id);
  });

  it('desactivarlo con comprobantes pendientes se rechaza', async () => {
    await setModule(true);
    pending = { queued: 0, rejected: 3, caeaNotReported: 0 };

    const response = await setModule(false);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'MODULO_CON_PENDIENTES' });
    expect((response.body as { mensaje: string }).mensaje).toContain('3 rechazado(s)');
  });
});

describe('[RF-017] tickets de soporte', () => {
  it('un AC crea un ticket, el SA lo responde y el AC ve la respuesta', async () => {
    const ac = await signIn(api.app, USERS.ac.email);
    const created = await request(api.app)
      .post('/soporte/tickets')
      .set('Authorization', ac.authorization)
      .send({ asunto: 'No imprime', mensaje: 'La impresora no responde.' });
    expect(created.status).toBe(201);
    expectToMatchContract(created, 'post', '/soporte/tickets');
    const ticket = created.body as TicketDetail;

    const sa = await asSa();
    const all = await request(api.app)
      .get('/plataforma/tickets?estado=abierto')
      .set('Authorization', sa);
    expectToMatchContract(all, 'get', '/plataforma/tickets');
    expect((all.body as TicketSummary[]).map((t) => t.id)).toContain(ticket.id);
    const reply = await request(api.app)
      .post(`/plataforma/tickets/${ticket.id}/respuestas`)
      .set('Authorization', sa)
      .send({ texto: 'Probá reiniciar el agente local.' });
    expectToMatchContract(reply, 'post', '/plataforma/tickets/{id}/respuestas');

    const seen = await request(api.app)
      .get(`/soporte/tickets/${ticket.id}`)
      .set('Authorization', ac.authorization);
    expectToMatchContract(seen, 'get', '/soporte/tickets/{id}');
    expect(seen.body).toMatchObject({
      estado: 'respondido',
      mensajes: [
        { deSoporte: false, texto: 'La impresora no responde.' },
        { deSoporte: true, texto: 'Probá reiniciar el agente local.' },
      ],
    });
  });

  it('un VO no puede crear tickets', async () => {
    const vo = await signIn(api.app, USERS.vo.email);

    const response = await request(api.app)
      .post('/soporte/tickets')
      .set('Authorization', vo.authorization)
      .send({ asunto: 'Hola', mensaje: 'x' });

    expect(response.status).toBe(403);
  });

  it('un usuario de otro comercio no ve el ticket', async () => {
    const ac = await signIn(api.app, USERS.ac.email);
    const ticket = (
      await request(api.app)
        .post('/soporte/tickets')
        .set('Authorization', ac.authorization)
        .send({ asunto: 'Consulta', mensaje: 'Una duda.' })
    ).body as TicketDetail;
    const asB = await signIn(api.app, USERS.voB.email);

    const response = await request(api.app)
      .get(`/soporte/tickets/${ticket.id}`)
      .set('Authorization', asB.authorization);

    expect([403, 404]).toContain(response.status);
  });
});

describe('[RF-022] auditoría técnica', () => {
  it('el SA la consulta y la respuesta no tiene campos comerciales', async () => {
    await request(api.app)
      .post('/auth/login')
      .send({ email: USERS.vo.email, contrasena: 'Mala-clave-123' });
    await signIn(api.app, USERS.vo.email);

    const response = await request(api.app)
      .get('/plataforma/auditoria-tecnica?limite=50')
      .set('Authorization', await asSa());

    expect(response.status).toBe(200);
    expectToMatchContract(response, 'get', '/plataforma/auditoria-tecnica');
    const entries = response.body as TechnicalAuditEntry[];
    expect(entries.map((e) => e.tipoEvento)).toEqual(
      expect.arrayContaining(['login_fallido', 'login_exitoso']),
    );
    const commercial = /precio|monto|total|venta|producto|stock|cliente|importe|pago/i;
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toStrictEqual([
        'actorId',
        'comercioId',
        'detalle',
        'id',
        'ip',
        'momento',
        'tipoEvento',
      ]);
      expect(Object.keys(entry.detalle).some((key) => commercial.test(key))).toBe(false);
    }
  });

  it('filtra por tipo de evento', async () => {
    await signIn(api.app, USERS.vo.email);

    const response = await request(api.app)
      .get('/plataforma/auditoria-tecnica?tipo=login_exitoso')
      .set('Authorization', await asSa());

    const types = new Set((response.body as TechnicalAuditEntry[]).map((e) => e.tipoEvento));
    expect([...types]).toStrictEqual(['login_exitoso']);
  });
});

describe('[RF-016] panel técnico', () => {
  it('un error forzado aparece en el panel del SA, sin la traza', async () => {
    const vo = await signIn(api.app, USERS.vo.email);
    const forced = await request(api.app)
      .get('/prueba/error-forzado')
      .set('Authorization', vo.authorization);
    expect(forced.status).toBe(500);
    // El registro del error no frena la respuesta: se espera a que quede escrito.
    await expect
      .poll(
        async () =>
          (await ownerSelect("SELECT 1 FROM auditoria_tecnica WHERE tipo_evento = 'error_interno'"))
            .length,
      )
      .toBe(1);

    const panel = await request(api.app)
      .get('/plataforma/panel')
      .set('Authorization', await asSa());

    expect(panel.status).toBe(200);
    expectToMatchContract(panel, 'get', '/plataforma/panel');
    const body = panel.body as TechnicalPanel;
    expect(body.erroresRecientes[0]).toMatchObject({
      metodo: 'GET',
      ruta: '/prueba/error-forzado',
      error: 'Error: fallo forzado de prueba',
    });
    expect(body.erroresRecientes[0]?.error).not.toContain('at ');
    expect(body.trabajos).toStrictEqual({ pendientes: 0, enCurso: 0, fallidos: 0 });
  });
});
