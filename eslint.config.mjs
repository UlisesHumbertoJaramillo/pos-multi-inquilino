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
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/coverage/',
      'test-results/',
      'playwright-report/',
      'packages/contracts/src/generated/',
    ],
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
    files: ['scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // La aplicación registra solo con el puerto Logger, que oculta datos sensibles (Const. 17).
    files: ['apps/backend/src/**/*.ts'],
    rules: { 'no-console': 'error' },
  },
  {
    files: ['apps/frontend/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    // Sistema visual único (AD-30, RF-193): los colores se definen solo en el tema.
    files: ['apps/frontend/src/**/*.{ts,tsx}'],
    ignores: ['apps/frontend/src/theme.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3}/]',
          message: 'Usá un color del tema (theme.ts), no un color literal.',
        },
        {
          selector: 'TemplateElement[value.raw=/#[0-9a-fA-F]{3}/]',
          message: 'Usá un color del tema (theme.ts), no un color literal.',
        },
        {
          selector: 'Literal[value=/(rgba?|hsla?)[(]/]',
          message: 'Usá un color del tema (theme.ts), no un color literal.',
        },
      ],
    },
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
