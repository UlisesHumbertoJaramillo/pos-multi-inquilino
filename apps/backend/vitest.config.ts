// Pruebas del backend (T-010, Const. 9).
// - unit: sin base de datos ni red.
// - integration: contra la base local pos_test, nunca contra pos_dev.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: ['**/*.int.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['src/**/*.int.test.ts', 'test/**/*.int.test.ts'],
          globalSetup: ['test/support/global-setup.ts'],
          setupFiles: ['test/support/integration-setup.ts'],
          // Comparten pos_test: se ejecutan de a un archivo para que el vaciado no se cruce.
          fileParallelism: false,
          // Contra una base real: con el equipo cargado, 5 segundos no alcanzan.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
