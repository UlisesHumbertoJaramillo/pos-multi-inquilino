import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, TEST_FRONTEND_ORIGIN } from '../../../../test/support/app.js';

describe('cabeceras de seguridad', () => {
  it('protegen las respuestas de la API', async () => {
    const response = await request(createTestApp()).get('/salud');

    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('incluyen HSTS solo cuando se pide (producción)', async () => {
    const withHsts = createTestApp({
      security: { allowedOrigins: [TEST_FRONTEND_ORIGIN], hsts: true },
    });

    const production = await request(withHsts).get('/salud');
    const development = await request(createTestApp()).get('/salud');

    expect(production.headers['strict-transport-security']).toContain('max-age=');
    expect(development.headers['strict-transport-security']).toBeUndefined();
  });

  it('en /docs permiten los scripts propios de Swagger UI', async () => {
    const response = await request(createTestApp({ devRoutes: true })).get('/docs/');

    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
  });
});

describe('CORS', () => {
  it('permite el origen del frontend', async () => {
    const response = await request(createTestApp())
      .get('/salud')
      .set('Origin', TEST_FRONTEND_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(TEST_FRONTEND_ORIGIN);
  });

  it('responde la verificación previa del navegador para el origen del frontend', async () => {
    const response = await request(createTestApp())
      .options('/salud')
      .set('Origin', TEST_FRONTEND_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Authorization, Content-Type');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(TEST_FRONTEND_ORIGIN);
    expect(response.headers['access-control-allow-headers']).toBe('Authorization,Content-Type');
  });

  it('rechaza en el servidor una solicitud desde un origen no permitido', async () => {
    const response = await request(createTestApp())
      .get('/salud')
      .set('Origin', 'https://otro-sitio.com');

    expect(response.status).toBe(403);
    expect(response.body).toStrictEqual({
      codigo: 'ORIGEN_NO_PERMITIDO',
      mensaje: 'El origen de la solicitud no está permitido.',
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('acepta solicitudes sin cabecera Origin, que no vienen de otro sitio', async () => {
    const response = await request(createTestApp()).get('/salud');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('cuerpo de la solicitud', () => {
  it('rechaza un cuerpo JSON de más de 100 KB', async () => {
    const response = await request(createTestApp())
      .post('/salud')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ relleno: 'x'.repeat(101 * 1024) }));

    expect(response.status).toBe(413);
    expect(response.body).toStrictEqual({
      codigo: 'SOLICITUD_DEMASIADO_GRANDE',
      mensaje: 'La solicitud supera el tamaño permitido.',
    });
  });

  it('rechaza un JSON mal formado con el error uniforme', async () => {
    const response = await request(createTestApp())
      .post('/salud')
      .set('Content-Type', 'application/json')
      .send('{"sin cerrar":');

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({
      codigo: 'SOLICITUD_INVALIDA',
      mensaje: 'La solicitud no es válida.',
    });
  });
});
