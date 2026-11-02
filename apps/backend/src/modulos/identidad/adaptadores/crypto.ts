// Adaptadores criptográficos del módulo de identidad.
import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { OpaqueTokens, SecretHasher } from '../aplicacion/ports.js';

export interface Argon2Options {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

// Valores recomendados por OWASP para argon2id.
export const DEFAULT_ARGON2_OPTIONS: Argon2Options = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

// Puerto HashDeSecretos con argon2id (T-025, RF-156): irreversible y con sal propia en cada hash.
export class Argon2SecretHasher implements SecretHasher {
  constructor(private readonly options: Argon2Options = DEFAULT_ARGON2_OPTIONS) {}

  hash(secret: string): Promise<string> {
    return argon2.hash(secret, { type: argon2.argon2id, ...this.options });
  }

  async verify(hash: string, secret: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, secret);
    } catch {
      // Un hash con formato inválido equivale a una credencial incorrecta.
      return false;
    }
  }
}

// Tokens opacos de 256 bits. Como tienen mucha entropía, basta un SHA-256 para guardarlos.
export const cryptoOpaqueTokens: OpaqueTokens = {
  generate() {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: cryptoOpaqueTokens.hash(token) };
  },
  hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  },
};
