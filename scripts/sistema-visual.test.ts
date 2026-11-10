// La regla de lint del sistema visual (T-254, AD-30): una pantalla no puede escribir colores; solo
// el tema los define. Se prueba con la configuración real del repositorio.
import { resolve } from 'node:path';
import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

async function ruleFor(file: string): Promise<Linter.RuleEntry | undefined> {
  const eslint = new ESLint({ cwd: ROOT });
  const config = (await eslint.calculateConfigForFile(resolve(ROOT, file))) as Linter.Config;
  return config.rules?.['no-restricted-syntax'];
}

async function lint(file: string, code: string) {
  const rule = await ruleFor(file);
  if (rule === undefined) return [];
  return new Linter().verify(
    code,
    [
      {
        files: ['**/*.tsx', '**/*.ts'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: { 'no-restricted-syntax': rule },
      },
    ],
    { filename: file },
  );
}

const PAGE = 'apps/frontend/src/pages/Prueba.tsx';

describe('[RF-193] los colores solo se definen en el tema', () => {
  it('un color hexadecimal en una pantalla hace fallar el lint', async () => {
    const errors = await lint(PAGE, "export const sx = { color: '#c62828' };");
    expect(errors.map((e) => e.message)).toEqual([
      'Usá un color del tema (theme.ts), no un color literal.',
    ]);
  });

  it('también un color rgb o dentro de un template', async () => {
    expect(await lint(PAGE, "export const a = 'rgba(0, 0, 0, 0.5)';")).toHaveLength(1);
    expect(await lint(PAGE, 'export const b = `1px solid #ccc`;')).toHaveLength(1);
  });

  it('usar el tema no es un error', async () => {
    expect(await lint(PAGE, "export const sx = { color: 'error.main' };")).toEqual([]);
  });

  it('el tema puede definir colores', async () => {
    expect(await lint('apps/frontend/src/theme.ts', "export const c = '#c62828';")).toEqual([]);
  });
});
