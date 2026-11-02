// Genera los certificados HTTPS de desarrollo con mkcert (T-004, Const. 17).
// Los usan el backend y el frontend. Quedan en certs/, que no se sube al repositorio.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CERTS_DIR = resolve(import.meta.dirname, '../../../certs');
const CERT_FILE = resolve(CERTS_DIR, 'localhost.pem');
const KEY_FILE = resolve(CERTS_DIR, 'localhost-key.pem');
const HOSTS = ['localhost', '127.0.0.1', '::1'];

function main(): void {
  mkdirSync(CERTS_DIR, { recursive: true });
  try {
    execFileSync('mkcert', ['-cert-file', CERT_FILE, '-key-file', KEY_FILE, ...HOSTS], {
      stdio: 'inherit',
    });
  } catch (error: unknown) {
    const code = (error as { code?: unknown }).code;
    console.error(
      code === 'ENOENT'
        ? 'Error: no se encontró mkcert. Instalalo, agregalo al PATH y corré `mkcert -install`.'
        : 'Error: mkcert no pudo generar los certificados.',
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Certificados generados en ${CERTS_DIR}.`);
}

main();
