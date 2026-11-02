import { Writable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { bearer, createTestApp } from '../../../../test/support/app.js';
import { createMemoryLogger } from '../../../../test/support/logger.js';
import { ApplicationError } from '../../aplicacion/errors.js';
import type { Logger } from '../../aplicacion/logger.js';
import { DomainError } from '../../dominio/errors.js';
import { createPinoLogger } from '../logging/pino-logger.js';
import { createErrorHandler, INTERNAL_ERROR, NOT_FOUND_ERROR } from './errors.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2byJ9.ZmlybWE';

// Aplicación mínima con una ruta que lanza el error indicado.
function appThrowing(error: unknown, logger: Logger = createMemoryLogger()): express.Express {
  const app = express();
  app.get('/falla', () => {
    throw error;
  });
  app.use(createErrorHandler(logger));
  return app;
}

describe('manejo uniforme de errores', () => {
  it('un error inesperado responde {codigo, mensaje} sin traza ni detalles internos', async () => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:5432');

    const response = await request(appThrowing(error)).get('/falla');

    expect(response.status).toBe(500);
    expect(response.body).toStrictEqual(INTERNAL_ERROR);
    expect(response.text).not.toContain('ECONNREFUSED');
    expect(response.text).not.toContain('at ');
  });

  it('registra el detalle del error inesperado, sin el token que traía', async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const logger = createPinoLogger({ destination });

    await request(appThrowing(new Error(`Token rechazado: ${JWT}`), logger)).get('/falla');

    const log = chunks.join('');
    expect(log).toContain('Token rechazado');
    expect(log).toContain('"path":"/falla"');
    expect(log).not.toContain(JWT);
  });

  it('un error de la aplicación responde con su código, su mensaje y el estado de su tipo', async () => {
    const error = new ApplicationError(
      'conflict',
      'STOCK_INSUFICIENTE',
      'No hay stock suficiente.',
    );

    const response = await request(appThrowing(error)).get('/falla');

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual({
      codigo: 'STOCK_INSUFICIENTE',
      mensaje: 'No hay stock suficiente.',
    });
  });

  it('una regla de negocio violada responde 409 con su código y su mensaje', async () => {
    const error = new DomainError('YA_DADO_DE_BAJA', 'El registro ya está dado de baja.');

    const response = await request(appThrowing(error)).get('/falla');

    expect(response.status).toBe(409);
    expect(response.body).toStrictEqual({
      codigo: 'YA_DADO_DE_BAJA',
      mensaje: 'El registro ya está dado de baja.',
    });
  });

  it('un error de cliente de Express responde 400 genérico, sin registrarse como fallo', async () => {
    const logger = createMemoryLogger();
    const parseError = Object.assign(new SyntaxError('Unexpected token } in JSON'), {
      status: 400,
      expose: true,
    });

    const response = await request(appThrowing(parseError, logger)).get('/falla');

    expect(response.status).toBe(400);
    expect(response.body).toStrictEqual({
      codigo: 'SOLICITUD_INVALIDA',
      mensaje: 'La solicitud no es válida.',
    });
    expect(logger.entries).toHaveLength(0);
  });

  it('una ruta inexistente responde 404 con el formato uniforme, a un usuario autenticado', async () => {
    const app = createTestApp();

    const response = await request(app)
      .get('/no-existe')
      .set('Authorization', await bearer());

    expect(response.status).toBe(404);
    expect(response.body).toStrictEqual(NOT_FOUND_ERROR);
  });
});
