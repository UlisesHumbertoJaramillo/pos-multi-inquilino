// Cifrado de la credencial fiscal con AES-256-GCM (AD-25). La clave maestra vive fuera de la base.
import { createCipheriv, createDecipheriv, randomBytes, X509Certificate } from 'node:crypto';
import type { SecretCipher } from '../aplicacion/ports.js';

const IV_BYTES = 12;

export class AesSecretCipher implements SecretCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('La clave maestra fiscal tiene que tener 32 bytes.');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
  }

  decrypt(value: string): string {
    const [iv, tag, data] = value.split('.').map((part) => Buffer.from(part, 'base64'));
    if (!iv || !tag || !data) throw new Error('Valor cifrado inválido.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}

export const certificateExpiry = (pem: string) => new Date(new X509Certificate(pem).validTo);
