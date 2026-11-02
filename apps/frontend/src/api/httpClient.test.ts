import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './httpClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('devuelve el cuerpo de una respuesta exitosa', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { estado: 'ok' })));

    await expect(apiRequest('/salud')).resolves.toStrictEqual({ estado: 'ok' });
  });

  it('convierte un error de la API en ApiError con su código y mensaje', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(404, { codigo: 'NO_ENCONTRADO', mensaje: 'No existe.' })),
    );

    await expect(apiRequest('/recurso')).rejects.toStrictEqual(
      new ApiError(404, 'NO_ENCONTRADO', 'No existe.'),
    );
  });

  it('usa un mensaje genérico si el error no trae el formato esperado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('fallo', { status: 500 })));

    await expect(apiRequest('/recurso')).rejects.toMatchObject({
      status: 500,
      code: null,
      message: 'Ocurrió un error inesperado.',
    });
  });

  it('informa la falta de conexión sin exponer el error de red', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiRequest('/salud')).rejects.toMatchObject({
      status: 0,
      message: 'No hay conexión con el servidor.',
    });
  });
});
