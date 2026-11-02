// Matriz de permisos sobre las rutas reales (T-038, T-059, T-071; RF-001, RF-003, RF-004).
// Se genera desde el registro de rutas: cada ruta con acción × cada rol. Al agregar una ruta con
// acción, sus casos se agregan solos.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { decide } from '../../src/compartido/aplicacion/permissions.js';
import { ROLES, type Role } from '../../src/compartido/dominio/roles.js';
import { createTestApi } from '../support/app.js';
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

const EMAIL_BY_ROLE: Record<Role, string> = {
  SA: USERS.sa.email,
  AC: USERS.ac.email,
  AS: USERS.asVo.email,
  VO: USERS.vo.email,
};

const routesWithAction = api.routes.filter((route) => route.action !== undefined);
const cases = routesWithAction.flatMap((route) => ROLES.map((role) => ({ route, role })));
const authorization = new Map<Role, string>();

// Un valor concreto para los parámetros de ruta.
const concretePath = (path: string) => path.replace(/:\w+/g, TENANT_A);

// El arnés vacía las tablas antes de cada prueba: las sesiones se crean de nuevo cada vez.
beforeEach(async () => {
  await seedIdentity();
  for (const role of ROLES) {
    authorization.set(role, (await signIn(api.app, EMAIL_BY_ROLE[role], role)).authorization);
  }
});

describe('[RF-004] matriz de permisos en las rutas', () => {
  it('hay rutas de plataforma y de comercio para probar', () => {
    expect(
      routesWithAction.filter((r) => r.path.startsWith('/plataforma/')).length,
    ).toBeGreaterThan(10);
    expect(routesWithAction.some((r) => !r.path.startsWith('/plataforma/'))).toBe(true);
  });

  it.each(cases)('$route.method $route.path con rol $role', async ({ route, role }) => {
    const allowed = decide(
      {
        userId: 'u',
        tenantId: role === 'SA' ? null : TENANT_A,
        activeRole: role,
        branchIds: [],
        sessionId: 's',
      },
      route.action ?? '',
    ).allowed;

    // Sin cuerpo: la verificación del permiso tiene que ocurrir antes que la de los datos.
    const response = await request(api.app)
      [route.method](concretePath(route.path))
      .set('Authorization', authorization.get(role) ?? '');

    if (allowed) {
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    } else {
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ codigo: 'SIN_PERMISO' });
    }
  });
});

describe('[RF-003] un usuario de un comercio no ejecuta acciones del SA', () => {
  const platformRoutes = routesWithAction.filter((route) => route.path.startsWith('/plataforma/'));

  it.each(platformRoutes)('el AC recibe 403 en $method $path', async (route) => {
    const response = await request(api.app)
      [route.method](concretePath(route.path))
      .set('Authorization', authorization.get('AC') ?? '');

    expect(response.status).toBe(403);
  });
});

// Acceso cruzado: el AC del comercio B usa ids de recursos del A en cada ruta de organización que
// recibe un id. Al agregar una ruta así, su caso se agrega solo.
describe('[RF-001] acceso cruzado entre comercios en las rutas de organización', () => {
  const REGISTER_A = 'a2000000-0000-4000-8000-000000000001';
  const PAYMENT_METHOD_A = 'a3000000-0000-4000-8000-000000000001';
  const FOREIGN: Record<string, { resourceType: string; id: string }> = {
    sucursales: { resourceType: 'sucursal', id: BRANCH_CENTRO },
    cajas: { resourceType: 'caja', id: REGISTER_A },
    usuarios: { resourceType: 'usuario', id: USERS.vo.id },
    'metodos-pago': { resourceType: 'metodo_pago', id: PAYMENT_METHOD_A },
  };
  // Un cuerpo válido: la respuesta tiene que depender del recurso, no de los datos.
  const bodyFor = (path: string) =>
    path.endsWith('/cajas')
      ? { nombre: 'Intrusa' }
      : path.endsWith('/roles')
        ? { roles: [{ rol: 'VO', sucursalId: BRANCH_B }] }
        : {};
  const crossTenantRoutes = routesWithAction.filter(
    (route) => route.path.startsWith('/organizacion/') && route.path.includes(':id'),
  );

  beforeEach(async () => {
    await ownerQuery(
      `INSERT INTO caja (id, tenant_id, sucursal_id, nombre, creado_en)
       VALUES ($1, $2, $3, 'Caja A', now())`,
      [REGISTER_A, TENANT_A, BRANCH_CENTRO],
    );
    await ownerQuery(
      `INSERT INTO metodo_pago (id, tenant_id, nombre, tipo, recargo_pct, creado_en)
       VALUES ($1, $2, 'Efectivo', 'efectivo', 0, now())`,
      [PAYMENT_METHOD_A, TENANT_A],
    );
  });

  it('cubre todas las rutas de organización con id', () => {
    expect(crossTenantRoutes.length).toBeGreaterThanOrEqual(9);
    for (const route of crossTenantRoutes) {
      expect(FOREIGN[route.path.split('/')[2] ?? '']).toBeDefined();
    }
  });

  it.each(crossTenantRoutes)('$method $path responde 404 y queda auditado', async (route) => {
    const target = FOREIGN[route.path.split('/')[2] ?? ''];
    if (!target) throw new Error(`Falta un recurso para ${route.path}`);
    const acB = (await signIn(api.app, USERS.acB.email)).authorization;

    const response = await request(api.app)
      [route.method](route.path.replace(':id', target.id))
      .set('Authorization', acB)
      .send(bodyFor(route.path));

    expect(response.status).toBe(404);
    const audit = await ownerSelect<{ actor_id: string; detalle: unknown }>(
      "SELECT actor_id, detalle FROM auditoria_tecnica WHERE tipo_evento = 'acceso_otro_comercio'",
    );
    expect(audit).toStrictEqual([
      {
        actor_id: USERS.acB.id,
        detalle: { resourceType: target.resourceType, resourceId: target.id },
      },
    ]);
  });
});
