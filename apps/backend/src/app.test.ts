import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { expectToMatchContract } from '../test/support/contract.js';
import { createApp } from './app.js';

describe('GET /salud', () => {
  it('responde solo el estado, sin datos internos', async () => {
    const response = await request(createApp({ devRoutes: false })).get('/salud');

    expect(response.status).toBe(200);
    expectToMatchContract(response, 'get', '/salud');
    expect(response.body).toStrictEqual({ estado: 'ok' });
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('/docs', () => {
  it('en desarrollo muestra Swagger UI con el contrato de la API', async () => {
    const app = createApp({ devRoutes: true });

    const page = await request(app).get('/docs/');
    const init = await request(app).get('/docs/swagger-ui-init.js');

    expect(page.status).toBe(200);
    expect(page.text).toContain('swagger-ui');
    expect(init.text).toContain('/salud');
  });

  it('en producción no se registra', async () => {
    const response = await request(createApp({ devRoutes: false })).get('/docs/');

    expect(response.status).toBe(404);
  });
});
