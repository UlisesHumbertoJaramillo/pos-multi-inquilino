import { describe, expect, it } from 'vitest';
import { askGateway, askRefund, MANUAL_AFTER_CHECKS, nextVerification } from './gateway.js';

describe('[RF-126] verificación de pagos', () => {
  const start = new Date('2026-11-02T12:00:00Z');

  it('consulta seguido al principio y después más espaciado', () => {
    expect(nextVerification(start, 0, start)?.toISOString()).toBe('2026-11-02T12:01:00.000Z');
    expect(nextVerification(start, MANUAL_AFTER_CHECKS, start)?.toISOString()).toBe(
      '2026-11-02T12:05:00.000Z',
    );
  });

  it('deja de consultar a las 24 horas', () => {
    expect(nextVerification(start, 9, new Date('2026-11-03T12:00:00Z'))).toBeNull();
  });
});

describe('[RF-075] fallas de la integración', () => {
  it('una excepción es un resultado incierto, nunca un cobro exitoso', async () => {
    await expect(askGateway(() => Promise.reject(new Error('caída')))).resolves.toStrictEqual({
      outcome: 'sin_respuesta',
      reference: null,
    });
    await expect(askRefund(() => Promise.reject(new Error('caída')))).resolves.toBe(
      'sin_respuesta',
    );
  });
});
