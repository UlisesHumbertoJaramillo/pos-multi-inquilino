// Verifica que los tipos de packages/contracts estén generados desde el openapi.yaml actual.
// Los genera en una carpeta temporal y los compara con los del repositorio.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CONTRACTS_DIR = resolve(import.meta.dirname, '../packages/contracts');
const GENERATED_DIR = join(CONTRACTS_DIR, 'src/generated');
// Dentro del paquete, para que Prettier use la misma configuración.
const CHECK_DIR = join(CONTRACTS_DIR, '.generated-check');

function readDir(dir: string): Map<string, string> {
  if (!existsSync(dir)) return new Map();
  return new Map(
    readdirSync(dir).map((file) => [
      file,
      readFileSync(join(dir, file), 'utf8').replaceAll('\r\n', '\n'),
    ]),
  );
}

try {
  execFileSync('npx', ['openapi-ts', '-f', 'openapi-ts.config.mjs'], {
    cwd: CONTRACTS_DIR,
    env: { ...process.env, CONTRACTS_OUTPUT: CHECK_DIR },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  const expected = readDir(CHECK_DIR);
  const actual = readDir(GENERATED_DIR);
  const differs =
    expected.size !== actual.size ||
    [...expected].some(([file, content]) => actual.get(file) !== content);
  if (differs) {
    console.error(
      '✖ Los tipos de packages/contracts no coinciden con openapi.yaml. Corré `npm run contracts:generate`.',
    );
    process.exitCode = 1;
  } else {
    console.log('✔ Los tipos de packages/contracts están al día con openapi.yaml.');
  }
} finally {
  rmSync(CHECK_DIR, { recursive: true, force: true });
}
