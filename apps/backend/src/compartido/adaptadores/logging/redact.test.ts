import { describe, expect, it } from 'vitest';
import { REDACTED, redactSensitive, redactText } from './redact.js';

describe('redactSensitive', () => {
  it('oculta contraseñas, PIN, tokens y datos de pago a cualquier profundidad', () => {
    const input = {
      email: 'vo@demo.com',
      password: 'secreta',
      usuario: { contraseña: 'otra', pin: '1234', refresh_token: 'abc' },
      headers: { Authorization: 'Bearer abc.def', cookie: 'sid=1' },
      pago: { numero_tarjeta: '4111111111111111', cvv: '123' },
      intentos: [{ accessToken: 'x' }],
    };

    expect(redactSensitive(input)).toStrictEqual({
      email: 'vo@demo.com',
      password: REDACTED,
      usuario: { contraseña: REDACTED, pin: REDACTED, refresh_token: REDACTED },
      headers: { Authorization: REDACTED, cookie: REDACTED },
      pago: { numero_tarjeta: REDACTED, cvv: REDACTED },
      intentos: [{ accessToken: REDACTED }],
    });
  });

  it('no oculta campos que solo se parecen a uno sensible', () => {
    expect(redactSensitive({ shipping: 'ok', opinion: 'buena' })).toStrictEqual({
      shipping: 'ok',
      opinion: 'buena',
    });
  });

  it('oculta tokens dentro del mensaje y la traza de un error', () => {
    const error = new Error('Falló con Bearer abc123');
    const result = redactSensitive<unknown>({ err: error }) as { err: Record<string, unknown> };

    expect(result.err.message).toBe(`Falló con Bearer ${REDACTED}`);
    expect(String(result.err.stack)).not.toContain('abc123');
    expect(result.err.type).toBe('Error');
  });

  it('no modifica el objeto original y tolera referencias circulares', () => {
    const input: Record<string, unknown> = { password: 'secreta' };
    input.self = input;

    const result = redactSensitive(input);

    expect(input.password).toBe('secreta');
    expect(result).toStrictEqual({ password: REDACTED, self: '[Circular]' });
  });
});

describe('redactText', () => {
  it('oculta un JWT dentro de un texto', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJh';
    expect(redactText(`token recibido: ${jwt}`)).toBe(`token recibido: ${REDACTED}`);
  });
});
