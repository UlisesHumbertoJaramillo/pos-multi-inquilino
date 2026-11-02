import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Certificados de desarrollo generados con `npm run certs` (T-004).
const CERT_FILE = fileURLToPath(new URL('../../certs/localhost.pem', import.meta.url));
const KEY_FILE = fileURLToPath(new URL('../../certs/localhost-key.pem', import.meta.url));

if (!existsSync(CERT_FILE) || !existsSync(KEY_FILE)) {
  throw new Error('Faltan los certificados HTTPS. Generalos con `npm run certs`.');
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    https: { cert: readFileSync(CERT_FILE), key: readFileSync(KEY_FILE) },
  },
});
