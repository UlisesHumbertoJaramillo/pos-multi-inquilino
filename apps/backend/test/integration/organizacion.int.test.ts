// Organización del comercio: sucursales, cajas, usuarios, parámetros y métodos de pago (T-060 a T-067).
import type {
  Branch,
  PaymentMethod,
  Register,
  SessionTokens,
  Structure,
  TenantParameters,
  TenantUser,
} from '@pos/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  NO_DEPENDENCIES,
  type Dependencies,
} from '../../src/modulos/organizacion/dominio/structure.js';
import { createTestApi, type TestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerSelect, withAppClient } from '../support/database.js';
import {
  BRANCH_B,
  BRANCH_CENTRO,
  BRANCH_NORTE,
  seedIdentity,
  signIn,
  TENANT_A,
  TENANT_B,
  USERS,
} from '../support/identity-fixtures.js';

// Dependencias simuladas: cada prueba decide qué impide una baja (T-063).
let dependencies: Dependencies = NO_DEPENDENCIES;
const api: TestApi = createTestApi({
  dependencies: {
    forBranch: () => Promise.resolve(dependencies),
    forRegister: () => Promise.resolve(dependencies),
    forUser: () => Promise.resolve(dependencies),
  },
});
afterAll(() => api.close());

let ac: string;

beforeEach(async () => {
  dependencies = NO_DEPENDENCIES;
  api.email.clear();
  await seedIdentity();
  ac = (await signIn(api.app, USERS.ac.email)).authorization;
});

async function acOfTenantB(): Promise<string> {
  return (await signIn(api.app, USERS.acB.email)).authorization;
}

async function createBranch(nombre = 'Sur'): Promise<Branch> {
  const response = await request(api.app)
    .post('/organizacion/sucursales')
    .set('Authorization', ac)
    .send({ nombre, direccion: 'Av. Siempreviva 742' });
  expect(response.status).toBe(201);
  return response.body as Branch;
}

async function foreignAccessAudit() {
  return ownerSelect<{ actor_id: string; detalle: unknown }>(
    "SELECT actor_id, detalle FROM auditoria_tecnica WHERE tipo_evento = 'acceso_otro_comercio'",
  );
}

describe('[RF-001] aislamiento de la estructura', () => {
  it('el comercio B no ve las sucursales del A, ni siquiera consultando la tabla', async () => {
    const visible = await withAppClient(async (client) => {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_B]);
      const rows = await client.query<{ id: string }>('SELECT id FROM sucursal ORDER BY id');
      await client.query('COMMIT');
      return rows.rows.map((row) => row.id);
    });

    expect(visible).toStrictEqual([BRANCH_B]);
  });

  it('la estructura de cada AC trae solo las sucursales de su comercio', async () => {
    const response = await request(api.app)
      .get('/organizacion/estructura')
      .set('Authorization', await acOfTenantB());

    expect(response.status).toBe(200);
    expect((response.body as Structure).sucursales.map((s) => s.id)).toStrictEqual([BRANCH_B]);
  });
});

describe('[RF-023] sucursales', () => {
  it('el AC crea, modifica y da de baja una sucursal, y todo queda en la auditoría comercial', async () => {
    const created = await request(api.app)
      .post('/organizacion/sucursales')
      .set('Authorization', ac)
      .send({ nombre: 'Sur', direccion: 'Av. Siempreviva 742' });
    expect(created.status).toBe(201);
    expectToMatchContract(created, 'post', '/organizacion/sucursales');
    const branch = created.body as Branch;

    const updated = await request(api.app)
      .patch(`/organizacion/sucursales/${branch.id}`)
      .set('Authorization', ac)
      .send({ nombre: 'Sur 2' });
    expect(updated.status).toBe(200);
    expectToMatchContract(updated, 'patch', '/organizacion/sucursales/{id}');
    expect(updated.body).toMatchObject({ nombre: 'Sur 2', direccion: 'Av. Siempreviva 742' });

    const removed = await request(api.app)
      .post(`/organizacion/sucursales/${branch.id}/baja`)
      .set('Authorization', ac);
    expect(removed.status).toBe(204);

    const row = await ownerSelect<{ is_active: boolean; desactivado_por: string }>(
      'SELECT is_active, desactivado_por FROM sucursal WHERE id = $1',
      [branch.id],
    );
    expect(row).toStrictEqual([{ is_active: false, desactivado_por: USERS.ac.id }]);
    const audit = await ownerSelect<{ accion: string }>(
      'SELECT accion FROM auditoria_comercial WHERE entidad_id = $1 ORDER BY momento, accion',
      [branch.id],
    );
    expect(audit.map((a) => a.accion).sort()).toStrictEqual([
      'sucursal_alta',
      'sucursal_baja',
      'sucursal_modificada',
    ]);
  });

  it('un nombre vacío se rechaza', async () => {
    const response = await request(api.app)
      .post('/organizacion/sucursales')
      .set('Authorization', ac)
      .send({ nombre: '  ' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'NOMBRE_INVALIDO' });
  });

  it('el AS y el VO no gestionan la estructura', async () => {
    const as = await signIn(api.app, USERS.asNorte.email);
    const vo = await signIn(api.app, USERS.vo.email);

    for (const { authorization } of [as, vo]) {
      const response = await request(api.app)
        .post('/organizacion/sucursales')
        .set('Authorization', authorization)
        .send({ nombre: 'Sur' });
      expect(response.status).toBe(403);
    }
  });
});

describe('[RF-024] cajas', () => {
  it('el AC crea una caja en una sucursal propia', async () => {
    const response = await request(api.app)
      .post(`/organizacion/sucursales/${BRANCH_CENTRO}/cajas`)
      .set('Authorization', ac)
      .send({ nombre: 'Caja 1', puntoVentaFiscal: 3 });

    expect(response.status).toBe(201);
    expectToMatchContract(response, 'post', '/organizacion/sucursales/{id}/cajas');
    expect(response.body).toMatchObject({ sucursalId: BRANCH_CENTRO, puntoVentaFiscal: 3 });
  });

  it('no puede crearla en una sucursal de otro comercio: responde 404 y queda auditado', async () => {
    const response = await request(api.app)
      .post(`/organizacion/sucursales/${BRANCH_B}/cajas`)
      .set('Authorization', ac)
      .send({ nombre: 'Intrusa' });

    expect(response.status).toBe(404);
    expectToMatchContract(response, 'post', '/organizacion/sucursales/{id}/cajas');
    expect(await foreignAccessAudit()).toStrictEqual([
      { actor_id: USERS.ac.id, detalle: { resourceType: 'sucursal', resourceId: BRANCH_B } },
    ]);
    expect(await ownerSelect('SELECT 1 FROM caja')).toHaveLength(0);
  });

  it('un punto de venta fiscal no se repite en el comercio', async () => {
    const first = await request(api.app)
      .post(`/organizacion/sucursales/${BRANCH_CENTRO}/cajas`)
      .set('Authorization', ac)
      .send({ nombre: 'Caja 1', puntoVentaFiscal: 5 });
    const second = await request(api.app)
      .post(`/organizacion/sucursales/${BRANCH_NORTE}/cajas`)
      .set('Authorization', ac)
      .send({ nombre: 'Caja 2', puntoVentaFiscal: 5 });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ codigo: 'PUNTO_DE_VENTA_EN_USO' });
  });

  it('la caja se modifica y se da de baja', async () => {
    const register = (
      await request(api.app)
        .post(`/organizacion/sucursales/${BRANCH_CENTRO}/cajas`)
        .set('Authorization', ac)
        .send({ nombre: 'Caja 1' })
    ).body as Register;

    const updated = await request(api.app)
      .patch(`/organizacion/cajas/${register.id}`)
      .set('Authorization', ac)
      .send({ nombre: 'Caja principal', puntoVentaFiscal: 7 });
    const removed = await request(api.app)
      .post(`/organizacion/cajas/${register.id}/baja`)
      .set('Authorization', ac);

    expect(updated.status).toBe(200);
    expectToMatchContract(updated, 'patch', '/organizacion/cajas/{id}');
    expect(updated.body).toMatchObject({ nombre: 'Caja principal', puntoVentaFiscal: 7 });
    expect(removed.status).toBe(204);
  });
});

describe('[RF-025] baja con dependencias', () => {
  it('con turnos abiertos o ventas en curso la baja se rechaza e indica qué la impide', async () => {
    const branch = await createBranch();
    dependencies = { openShifts: 1, carts: 2, pendingTransfers: 0 };

    const response = await request(api.app)
      .post(`/organizacion/sucursales/${branch.id}/baja`)
      .set('Authorization', ac);

    expect(response.status).toBe(409);
    expectToMatchContract(response, 'post', '/organizacion/sucursales/{id}/baja');
    expect(response.body).toStrictEqual({
      codigo: 'BAJA_CON_DEPENDENCIAS',
      mensaje:
        'No se puede dar de baja la sucursal: tiene 1 turno(s) abierto(s), 2 venta(s) en curso.',
    });
    const row = await ownerSelect<{ is_active: boolean }>(
      'SELECT is_active FROM sucursal WHERE id = $1',
      [branch.id],
    );
    expect(row).toStrictEqual([{ is_active: true }]);
  });

  it('con transferencias pendientes tampoco se da de baja una caja', async () => {
    const register = (
      await request(api.app)
        .post(`/organizacion/sucursales/${BRANCH_CENTRO}/cajas`)
        .set('Authorization', ac)
        .send({ nombre: 'Caja 1' })
    ).body as Register;
    dependencies = { openShifts: 0, carts: 0, pendingTransfers: 1 };

    const response = await request(api.app)
      .post(`/organizacion/cajas/${register.id}/baja`)
      .set('Authorization', ac);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'BAJA_CON_DEPENDENCIAS' });
  });

  it('la baja de una sucursal da de baja sus cajas', async () => {
    const branch = await createBranch();
    await request(api.app)
      .post(`/organizacion/sucursales/${branch.id}/cajas`)
      .set('Authorization', ac)
      .send({ nombre: 'Caja 1' });

    await request(api.app)
      .post(`/organizacion/sucursales/${branch.id}/baja`)
      .set('Authorization', ac);

    const registers = await ownerSelect<{ is_active: boolean }>(
      'SELECT is_active FROM caja WHERE sucursal_id = $1',
      [branch.id],
    );
    expect(registers).toStrictEqual([{ is_active: false }]);
  });
});

describe('[RF-026] usuarios del comercio', () => {
  it('el AC crea un VO para una sucursal y se envía el correo de activación', async () => {
    const response = await request(api.app)
      .post('/organizacion/usuarios')
      .set('Authorization', ac)
      .send({
        email: 'nuevo.vo@prueba.local',
        nombre: 'Nuevo Vendedor',
        roles: [{ rol: 'VO', sucursalId: BRANCH_NORTE }],
      });

    expect(response.status).toBe(201);
    expectToMatchContract(response, 'post', '/organizacion/usuarios');
    expect(api.email.lastTokenFor('nuevo.vo@prueba.local')).toBeTruthy();
    const list = await request(api.app).get('/organizacion/usuarios').set('Authorization', ac);
    expectToMatchContract(list, 'get', '/organizacion/usuarios');
    const created = (list.body as TenantUser[]).find((u) => u.email === 'nuevo.vo@prueba.local');
    expect(created).toMatchObject({
      activo: true,
      correoValidado: false,
      roles: [{ rol: 'VO', sucursalId: BRANCH_NORTE }],
    });
    expect((list.body as TenantUser[]).some((u) => u.email === USERS.voB.email)).toBe(false);
  });

  it('un VO sin sucursal, o en una sucursal de otro comercio, se rechaza', async () => {
    const send = (sucursalId: string | null) =>
      request(api.app)
        .post('/organizacion/usuarios')
        .set('Authorization', ac)
        .send({ email: 'otro@prueba.local', nombre: 'Otro', roles: [{ rol: 'VO', sucursalId }] });

    expect(((await send(null)).body as { codigo: string }).codigo).toBe('ROLES_INVALIDOS');
    expect(((await send(BRANCH_B)).body as { codigo: string }).codigo).toBe('SUCURSAL_INVALIDA');
  });

  it('el cambio de roles queda en la auditoría comercial y cierra sus sesiones', async () => {
    const vo = await signIn(api.app, USERS.vo.email);

    const response = await request(api.app)
      .put(`/organizacion/usuarios/${USERS.vo.id}/roles`)
      .set('Authorization', ac)
      .send({ roles: [{ rol: 'AS', sucursalId: BRANCH_NORTE }] });

    expect(response.status).toBe(200);
    expectToMatchContract(response, 'put', '/organizacion/usuarios/{id}/roles');
    expect((response.body as TenantUser).roles).toStrictEqual([
      { rol: 'AS', sucursalId: BRANCH_NORTE },
    ]);
    const audit = await ownerSelect<{ accion: string }>(
      "SELECT accion FROM auditoria_comercial WHERE entidad_id = $1 AND accion = 'roles_modificados'",
      [USERS.vo.id],
    );
    expect(audit).toHaveLength(1);
    const session = await request(api.app)
      .get('/auth/sesion')
      .set('Authorization', vo.authorization);
    expect(session.status).toBe(401);
    // Los roles anteriores se conservan dados de baja (RN-02).
    const roles = await ownerSelect<{ rol: string; is_active: boolean }>(
      'SELECT rol, is_active FROM usuario_rol WHERE usuario_id = $1 ORDER BY is_active',
      [USERS.vo.id],
    );
    expect(roles).toStrictEqual([
      { rol: 'VO', is_active: false },
      { rol: 'AS', is_active: true },
    ]);
  });

  it('el comercio no se queda sin AC', async () => {
    const response = await request(api.app)
      .put(`/organizacion/usuarios/${USERS.ac.id}/roles`)
      .set('Authorization', ac)
      .send({ roles: [{ rol: 'AS', sucursalId: BRANCH_CENTRO }] });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'ULTIMO_ADMINISTRADOR' });
  });

  it('el AC da de baja a un usuario, pero no a sí mismo', async () => {
    const removed = await request(api.app)
      .post(`/organizacion/usuarios/${USERS.vo.id}/baja`)
      .set('Authorization', ac);
    const self = await request(api.app)
      .post(`/organizacion/usuarios/${USERS.ac.id}/baja`)
      .set('Authorization', ac);

    expect(removed.status).toBe(204);
    expect(self.status).toBe(409);
    expect(self.body).toMatchObject({ codigo: 'BAJA_PROPIA' });
    const login = await request(api.app)
      .post('/auth/login')
      .send({ email: USERS.vo.email, contrasena: 'Clave-de-prueba-1' });
    expect(login.status).toBe(401);
  });

  it('un usuario de otro comercio responde como inexistente y queda auditado', async () => {
    const response = await request(api.app)
      .put(`/organizacion/usuarios/${USERS.voB.id}/roles`)
      .set('Authorization', ac)
      .send({ roles: [{ rol: 'VO', sucursalId: BRANCH_CENTRO }] });

    expect(response.status).toBe(404);
    expect(await foreignAccessAudit()).toStrictEqual([
      { actor_id: USERS.ac.id, detalle: { resourceType: 'usuario', resourceId: USERS.voB.id } },
    ]);
  });
});

describe('[RF-135] parámetros del comercio', () => {
  it('sin configurar, devuelve los valores por defecto', async () => {
    const response = await request(api.app)
      .get('/organizacion/parametros')
      .set('Authorization', ac);

    expect(response.status).toBe(200);
    expectToMatchContract(response, 'get', '/organizacion/parametros');
    expect(response.body).toMatchObject({ inactividadCarritoMin: 15, inactividadSesionMin: 30 });
  });

  it('el AC modifica un parámetro dentro de los márgenes', async () => {
    const response = await request(api.app)
      .patch('/organizacion/parametros')
      .set('Authorization', ac)
      .send({ plazoDevolucionDias: 15, toleranciaArqueo: '50' });

    expect(response.status).toBe(200);
    expectToMatchContract(response, 'patch', '/organizacion/parametros');
    expect(response.body as TenantParameters).toMatchObject({
      plazoDevolucionDias: 15,
      toleranciaArqueo: '50.00',
    });
    const audit = await ownerSelect(
      "SELECT 1 FROM auditoria_comercial WHERE accion = 'parametros_modificados'",
    );
    expect(audit).toHaveLength(1);
  });

  it('un valor fuera de los márgenes de la plataforma se rechaza', async () => {
    const response = await request(api.app)
      .patch('/organizacion/parametros')
      .set('Authorization', ac)
      .send({ inactividadCarritoMin: 500 });

    expect(response.status).toBe(409);
    expectToMatchContract(response, 'patch', '/organizacion/parametros');
    expect(response.body).toMatchObject({ codigo: 'PARAMETRO_FUERA_DE_MARGEN' });
    expect(await ownerSelect('SELECT 1 FROM parametro_comercio')).toHaveLength(0);
  });

  it('la política de facturación exige el módulo de facturación activo', async () => {
    const response = await request(api.app)
      .patch('/organizacion/parametros')
      .set('Authorization', ac)
      .send({ politicaFacturacion: 'opcional_sin_factura' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'MODULO_FACTURACION_INACTIVO' });
  });
});

describe('[RF-009] inactividad de sesión del comercio', () => {
  it('la renovación respeta la inactividad configurada por el comercio', async () => {
    await request(api.app)
      .patch('/organizacion/parametros')
      .set('Authorization', ac)
      .send({ inactividadSesionMin: 60 });
    const vo = await signIn(api.app, USERS.vo.email);
    const voB = await signIn(api.app, USERS.voB.email);
    api.clock.advance(45 * 60_000);

    const refresh = (token: string) =>
      request(api.app).post('/auth/renovar').send({ tokenRenovacion: token });
    const own = await refresh(vo.refreshToken);
    const other = await refresh(voB.refreshToken);

    // El comercio A amplió a 60 minutos; el B sigue con los 30 por defecto.
    expect(own.status).toBe(200);
    expect((own.body as SessionTokens).tokenRenovacion).toBeTruthy();
    expect(other.status).toBe(401);
  });
});

describe('[RF-135] métodos de pago', () => {
  it('el AC crea "Tarjeta crédito +10%" y "Efectivo −5%"', async () => {
    const card = await request(api.app)
      .post('/organizacion/metodos-pago')
      .set('Authorization', ac)
      .send({ nombre: 'Tarjeta crédito', tipo: 'electronico', recargoPct: '10' });
    const cash = await request(api.app)
      .post('/organizacion/metodos-pago')
      .set('Authorization', ac)
      .send({ nombre: 'Efectivo', tipo: 'efectivo', recargoPct: '-5' });

    expect(card.status).toBe(201);
    expectToMatchContract(card, 'post', '/organizacion/metodos-pago');
    expect(card.body).toMatchObject({ nombre: 'Tarjeta crédito', recargoPct: '10.0000' });
    expect(cash.body).toMatchObject({ nombre: 'Efectivo', recargoPct: '-5.0000' });
    const list = await request(api.app).get('/organizacion/metodos-pago').set('Authorization', ac);
    expectToMatchContract(list, 'get', '/organizacion/metodos-pago');
    expect((list.body as PaymentMethod[]).map((m) => m.nombre)).toStrictEqual([
      'Efectivo',
      'Tarjeta crédito',
    ]);
  });

  it('un recargo fuera de margen se rechaza', async () => {
    const response = await request(api.app)
      .post('/organizacion/metodos-pago')
      .set('Authorization', ac)
      .send({ nombre: 'Usura', tipo: 'electronico', recargoPct: '250' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'RECARGO_INVALIDO' });
  });

  it('el recargo se modifica, el cambio queda auditado, y el método se da de baja', async () => {
    const method = (
      await request(api.app)
        .post('/organizacion/metodos-pago')
        .set('Authorization', ac)
        .send({ nombre: 'Débito', tipo: 'electronico', recargoPct: '0' })
    ).body as PaymentMethod;

    const updated = await request(api.app)
      .patch(`/organizacion/metodos-pago/${method.id}`)
      .set('Authorization', ac)
      .send({ recargoPct: '2.5' });
    const removed = await request(api.app)
      .post(`/organizacion/metodos-pago/${method.id}/baja`)
      .set('Authorization', ac);
    const list = await request(api.app).get('/organizacion/metodos-pago').set('Authorization', ac);

    expect(updated.status).toBe(200);
    expectToMatchContract(updated, 'patch', '/organizacion/metodos-pago/{id}');
    expect(updated.body).toMatchObject({ recargoPct: '2.5000' });
    expect(removed.status).toBe(204);
    expect(list.body).toStrictEqual([]);
    const audit = await ownerSelect<{ estado_anterior: { surchargePct: string } }>(
      "SELECT estado_anterior FROM auditoria_comercial WHERE accion = 'metodo_pago_modificado'",
    );
    expect(audit[0]?.estado_anterior.surchargePct).toBe('0.0000');
  });
});

describe('[RF-027] jerarquía del comercio', () => {
  it('muestra Comercio > Sucursales > Cajas', async () => {
    await request(api.app)
      .post(`/organizacion/sucursales/${BRANCH_CENTRO}/cajas`)
      .set('Authorization', ac)
      .send({ nombre: 'Caja 1', puntoVentaFiscal: 1 });
    await request(api.app)
      .post(`/organizacion/sucursales/${BRANCH_CENTRO}/cajas`)
      .set('Authorization', ac)
      .send({ nombre: 'Caja 2', puntoVentaFiscal: 2 });

    const response = await request(api.app)
      .get('/organizacion/estructura')
      .set('Authorization', ac);

    expect(response.status).toBe(200);
    expectToMatchContract(response, 'get', '/organizacion/estructura');
    const structure = response.body as Structure;
    expect(structure.comercio).toStrictEqual({ id: TENANT_A, nombre: 'Comercio A' });
    expect(
      structure.sucursales.map((s) => ({ nombre: s.nombre, cajas: s.cajas.map((c) => c.nombre) })),
    ).toStrictEqual([
      { nombre: 'Centro', cajas: ['Caja 1', 'Caja 2'] },
      { nombre: 'Norte', cajas: [] },
    ]);
  });

  it('las bajas solo aparecen si se piden', async () => {
    const branch = await createBranch();
    await request(api.app)
      .post(`/organizacion/sucursales/${branch.id}/baja`)
      .set('Authorization', ac);

    const active = await request(api.app).get('/organizacion/estructura').set('Authorization', ac);
    const all = await request(api.app)
      .get('/organizacion/estructura?incluirBajas=true')
      .set('Authorization', ac);

    expect((active.body as Structure).sucursales).toHaveLength(2);
    expect((all.body as Structure).sucursales).toHaveLength(3);
  });
});
