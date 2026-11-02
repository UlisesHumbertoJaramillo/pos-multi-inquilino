// Matriz de permisos sobre las rutas reales (T-038, T-059; RF-003, RF-004).
// Se genera desde el registro de rutas: cada ruta con acción × cada rol. Al agregar una ruta con
// acción, sus casos se agregan solos.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { decide } from '../../src/compartido/aplicacion/permissions.js';
import { ROLES, type Role } from '../../src/compartido/dominio/roles.js';
import { createTestApi } from '../support/app.js';
import { seedIdentity, signIn, TENANT_A, USERS } from '../support/identity-fixtures.js';

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
