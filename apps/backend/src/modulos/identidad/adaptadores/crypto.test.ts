import { describe, expect, it } from 'vitest';
import { Argon2SecretHasher, cryptoOpaqueTokens } from './crypto.js';

// Parámetros livianos: la prueba verifica el comportamiento, no la resistencia del hash.
const hasher = new Argon2SecretHasher({ memoryCost: 1024, timeCost: 1, parallelism: 1 });

describe('[RF-156] HashDeSecretos con argon2', () => {
  it('el hash no contiene el secreto y es argon2id', async () => {
    const hash = await hasher.hash('Contraseña-Secreta-1');

    expect(hash).not.toContain('Contraseña-Secreta-1');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('la verificación acepta el secreto correcto y rechaza otro', async () => {
    const hash = await hasher.hash('4321');

    expect(await hasher.verify(hash, '4321')).toBe(true);
    expect(await hasher.verify(hash, '1234')).toBe(false);
  });

  it('dos hashes del mismo secreto son distintos (sal propia)', async () => {
    expect(await hasher.hash('igual')).not.toBe(await hasher.hash('igual'));
  });

  it('un hash con formato inválido equivale a una credencial incorrecta', async () => {
    expect(await hasher.verify('no-es-un-hash', 'x')).toBe(false);
  });
});

describe('tokens opacos', () => {
  it('generan valores distintos y guardan solo su hash', () => {
    const first = cryptoOpaqueTokens.generate();
    const second = cryptoOpaqueTokens.generate();

    expect(first.token).not.toBe(second.token);
    expect(first.hash).toBe(cryptoOpaqueTokens.hash(first.token));
    expect(first.hash).not.toContain(first.token);
  });
});
