// @ts-check
// Configuración de ESLint compartida por todo el monorepo (Const. 8).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // packages/contracts/src/generated: tipos generados desde openapi.yaml, no se editan a mano.
  {
    ignores: ['**/node_modules/', '**/dist/', '**/coverage/', 'packages/contracts/src/generated/'],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // vite.config.ts y vitest.config.ts corren en Node: se analiza con su propio tsconfig.
          allowDefaultProject: ['apps/frontend/vite.config.ts', 'apps/frontend/vitest.config.ts'],
          defaultProject: 'apps/frontend/tsconfig.node.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['apps/backend/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/frontend/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/frontend/vite.config.ts', 'apps/frontend/vitest.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Archivos de configuración en JavaScript: fuera de los proyectos de TypeScript.
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    // CommonJS: require es la forma de importar.
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // Va al final: desactiva las reglas de estilo que resuelve Prettier.
  prettier,
);
