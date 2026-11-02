// Punto de entrada del backend: sirve la API solo por HTTPS (Const. 17).
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { resolve } from 'node:path';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT ?? '3000');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const CERTS_DIR = resolve(import.meta.dirname, '../../../certs');
const CERT_FILE = resolve(CERTS_DIR, 'localhost.pem');
const KEY_FILE = resolve(CERTS_DIR, 'localhost-key.pem');

if (!existsSync(CERT_FILE) || !existsSync(KEY_FILE)) {
  console.error('Error: faltan los certificados HTTPS. Generalos con `npm run certs`.');
  process.exit(1);
}

const server = createServer(
  { cert: readFileSync(CERT_FILE), key: readFileSync(KEY_FILE) },
  createApp({ devRoutes: !IS_PRODUCTION }),
);

server.listen(PORT, () => {
  console.log(`API escuchando en https://localhost:${String(PORT)}`);
});
