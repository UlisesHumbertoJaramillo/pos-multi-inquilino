// Pruebas del frontend (T-010). Separado de vite.config.ts para no depender de los certificados HTTPS.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // Las pantallas se prueban en un DOM simulado.
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    // Las pantallas con MUI en jsdom son lentas cuando corren varios archivos en paralelo.
    testTimeout: 60_000,
  },
});
