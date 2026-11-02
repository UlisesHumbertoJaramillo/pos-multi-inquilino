import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createPinoLogger } from './pino-logger.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2byJ9.ZmlybWE';

function captureLogger(): { logger: ReturnType<typeof createPinoLogger>; output: () => string } {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { logger: createPinoLogger({ destination }), output: () => chunks.join('') };
}

describe('createPinoLogger', () => {
  it('nunca escribe tokens, contraseñas ni PIN en el log', () => {
    const { logger, output } = captureLogger();

    logger.info(`Inicio de sesión con Bearer ${JWT}`, {
      accessToken: JWT,
      body: { password: 'Secreta123', pin: '4321' },
      err: new Error(`token inválido: ${JWT}`),
    });

    const log = output();
    expect(log).not.toContain(JWT);
    expect(log).not.toContain('Secreta123');
    expect(log).not.toContain('4321');
    expect(log).toContain('[OCULTO]');
  });

  it('escribe JSON con nivel, momento y mensaje', () => {
    const { logger, output } = captureLogger();

    logger.warn('Algo para revisar', { sucursal: 'Centro' });

    const entry = JSON.parse(output()) as Record<string, unknown>;
    expect(entry).toMatchObject({ level: 'warn', msg: 'Algo para revisar', sucursal: 'Centro' });
    expect(typeof entry.time).toBe('string');
  });
});
