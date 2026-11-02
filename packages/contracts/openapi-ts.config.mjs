// @ts-check
// Generación de tipos desde openapi.yaml (T-013, AD-21). Solo tipos: sin cliente HTTP ni lógica (AD-01).
import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: 'openapi.yaml',
  output: {
    // contracts:check genera en otra carpeta para comparar.
    path: process.env.CONTRACTS_OUTPUT ?? 'src/generated',
    entryFile: false,
    // El backend resuelve módulos con NodeNext, que exige la extensión.
    module: { extension: '.js' },
    postProcess: ['prettier'],
  },
  plugins: ['@hey-api/typescript'],
});
