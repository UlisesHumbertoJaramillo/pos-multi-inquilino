// Genera sdd/trazabilidad.md: qué pruebas verifican cada RF del spec (T-018, criterio 1).
//   npm run trazabilidad              escribe el archivo
//   npm run trazabilidad -- --check   falla si el archivo está desactualizado
//   npm run trazabilidad -- --strict  falla si algún RF no tiene pruebas
// Siempre falla si una prueba etiqueta un RF que no existe en el spec.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface Requirement {
  id: string;
  section: string;
  text: string;
}

export interface TestReference {
  file: string;
  title: string;
}

const ROOT = resolve(import.meta.dirname, '..');
const SPEC_PATH = join(ROOT, 'sdd/spec.md');
const OUTPUT_PATH = join(ROOT, 'sdd/trazabilidad.md');
// scripts/ queda afuera: sus pruebas usan etiquetas de ejemplo, no verifican RF.
const SEARCH_DIRS = ['apps', 'packages', 'e2e'];
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);
const TEST_FILE = /\.(test|spec)\.tsx?$/;
const TAG = /\[RF-(\d{3})\]/g;
const MAX_TEXT_LENGTH = 90;

export function parseRequirements(spec: string): Requirement[] {
  const requirements: Requirement[] = [];
  let section = '';
  for (const line of spec.split(/\r?\n/)) {
    const heading = /^### (5\.\d+) (.+)$/.exec(line);
    if (heading) {
      section = `§${heading[1] ?? ''}`;
      continue;
    }
    const row = /^\| (RF-\d{3}) \| (.+?) \|/.exec(line);
    if (row?.[1] && row[2]) {
      requirements.push({ id: row[1], section, text: row[2].trim() });
    }
  }
  return requirements;
}

// Título de la prueba: el primer texto entre comillas de la línea que lleva la etiqueta.
function titleOf(line: string): string {
  const literal = /(['"`])((?:\\.|(?!\1).)*)\1/.exec(line);
  return (literal?.[2] ?? line.trim()).trim();
}

export function extractReferences(file: string, content: string): Map<string, TestReference[]> {
  const references = new Map<string, TestReference[]>();
  for (const line of content.split(/\r?\n/)) {
    for (const match of line.matchAll(TAG)) {
      const id = `RF-${match[1] ?? ''}`;
      const list = references.get(id) ?? [];
      list.push({ file, title: titleOf(line) });
      references.set(id, list);
    }
  }
  return references;
}

function findTestFiles(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (IGNORED_DIRS.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return findTestFiles(path);
    return TEST_FILE.test(entry.name) ? [path] : [];
  });
}

function shorten(text: string): string {
  const clean = text.replaceAll('|', '\\|');
  return clean.length <= MAX_TEXT_LENGTH ? clean : `${clean.slice(0, MAX_TEXT_LENGTH - 1)}…`;
}

export function renderTable(
  requirements: Requirement[],
  references: Map<string, TestReference[]>,
): string {
  const covered = requirements.filter((req) => references.has(req.id)).length;
  const rows = requirements.map((req) => {
    const tests = (references.get(req.id) ?? [])
      .map(
        (ref) =>
          `[${ref.file.split('/').pop() ?? ref.file}](../${ref.file}): ${shorten(ref.title)}`,
      )
      .join('<br>');
    return `| ${req.id} | ${req.section} | ${shorten(req.text)} | ${tests || '—'} |`;
  });
  return [
    '# Trazabilidad RF ↔ pruebas',
    '',
    '> Generado por `npm run trazabilidad` desde las etiquetas `[RF-xxx]` de las pruebas. No se edita a mano.',
    '',
    `**Cobertura:** ${String(covered)} de ${String(requirements.length)} RF con al menos una prueba.`,
    '',
    '| RF | Sección | Requisito | Pruebas |',
    '| :-- | :-- | :-- | :-- |',
    ...rows,
    '',
  ].join('\n');
}

export function collectReferences(files: { path: string; content: string }[]) {
  const all = new Map<string, TestReference[]>();
  for (const { path, content } of files) {
    for (const [id, refs] of extractReferences(path, content)) {
      all.set(id, [...(all.get(id) ?? []), ...refs]);
    }
  }
  return all;
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const requirements = parseRequirements(readFileSync(SPEC_PATH, 'utf8'));
  const files = SEARCH_DIRS.flatMap((dir) => findTestFiles(join(ROOT, dir)))
    .map((path) => relative(ROOT, path).split(sep).join('/'))
    .sort()
    .map((path) => ({ path, content: readFileSync(join(ROOT, path), 'utf8') }));
  const references = collectReferences(files);

  const known = new Set(requirements.map((req) => req.id));
  const unknown = [...references.keys()].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    console.error(`✖ Etiquetas de RF que no existen en el spec: ${unknown.join(', ')}.`);
    process.exit(1);
  }

  const table = renderTable(requirements, references);
  const missing = requirements.filter((req) => !references.has(req.id));

  if (args.has('--check')) {
    const current = readFileSync(OUTPUT_PATH, 'utf8').replaceAll('\r\n', '\n');
    if (current !== table) {
      console.error('✖ sdd/trazabilidad.md está desactualizado. Corré `npm run trazabilidad`.');
      process.exit(1);
    }
    console.log('✔ sdd/trazabilidad.md está al día.');
  } else {
    writeFileSync(OUTPUT_PATH, table);
    console.log(
      `Trazabilidad generada: ${String(requirements.length - missing.length)} de ${String(requirements.length)} RF con pruebas.`,
    );
  }

  if (args.has('--strict') && missing.length > 0) {
    console.error(
      `✖ ${String(missing.length)} RF sin pruebas: ${missing.map((req) => req.id).join(', ')}.`,
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
