// Recorrido de todas las rutas registradas (T-031, AD-22, Const. 16).
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { allRoutes } from '../../src/app.js';
import { PUBLIC_ROUTE_REASONS } from '../../src/compartido/adaptadores/http/routes.js';
import { bearer, createTestApi } from '../support/app.js';

const api = createTestApi();
afterAll(() => api.close());

const routes = allRoutes({ routes: api.identity.routes });
// Un valor concreto para los parámetros de ruta, como /autorizaciones/:id.
const concretePath = (path: string) =>
  path.replace(/:\w+/g, '00000000-0000-4000-8000-000000000000');

describe('rutas protegidas por defecto', () => {
  it.each(routes.filter((route) => route.public === undefined))(
    'sin token, $method $path responde 401',
    async (route) => {
      const response = await request(api.app)[route.method](concretePath(route.path));

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ codigo: 'NO_AUTENTICADO' });
    },
  );

  it.each(routes.filter((route) => route.public === undefined))(
    'con un token falso, $method $path responde 401',
    async (route) => {
      const response = await request(api.app)
        [route.method](concretePath(route.path))
        .set('Authorization', 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.firma');

      expect(response.status).toBe(401);
    },
  );

  it('solo son públicas las rutas de la lista blanca de AD-22', () => {
    const publicRoutes = routes
      .filter((route) => route.public !== undefined)
      .map((route) => `${route.method.toUpperCase()} ${route.path} (${route.public ?? ''})`);

    expect(publicRoutes).toStrictEqual([
      'GET /salud (salud)',
      'POST /auth/login (inicio_sesion)',
      'POST /auth/renovar (inicio_sesion)',
      'POST /auth/validacion/reenviar (validacion_correo)',
      'POST /auth/validacion/confirmar (validacion_correo)',
      'POST /auth/recuperacion/solicitar (recuperacion_contrasena)',
      'POST /auth/recuperacion/restablecer (recuperacion_contrasena)',
    ]);
    for (const route of routes) {
      if (route.public !== undefined) expect(PUBLIC_ROUTE_REASONS).toContain(route.public);
    }
  });

  it('una ruta inexistente responde 401 sin token, para no revelar qué rutas existen', async () => {
    expect((await request(api.app).get('/no-existe')).status).toBe(401);
    expect((await request(api.app).get('/dev/simuladores')).status).toBe(401);
  });
});

describe('rutas solo para desarrollo', () => {
  it('ninguna ruta registrada es de /dev ni de /docs', () => {
    expect(routes.some((route) => /^\/(dev|docs)\b/.test(route.path))).toBe(false);
  });

  it('en modo producción, /docs no existe ni para un usuario autenticado', async () => {
    const { createTestApp } = await import('../support/app.js');
    const production = createTestApp({ devRoutes: false });

    const response = await request(production)
      .get('/docs/')
      .set('Authorization', await bearer());

    expect(response.status).toBe(404);
  });
});
