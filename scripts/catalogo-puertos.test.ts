// El catálogo de arquitectura se mantiene al día con el código (T-249, Const. 14): cada puerto y cada
// adaptador que lo implementa tienen que figurar en docs/arquitectura/puertos-y-adaptadores.md.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'apps/backend/src');
const CATALOG = readFileSync(join(ROOT, 'docs/arquitectura/puertos-y-adaptadores.md'), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path,
  content: readFileSync(path, 'utf8'),
}));

// Un puerto es una interfaz de la capa de aplicación que declara métodos; las que solo tienen
// campos son datos que viajan por los puertos.
function portsIn(content: string): string[] {
  const ports: string[] = [];
  for (const match of content.matchAll(/^export interface (\w+)[^{]*\{\r?\n([\s\S]*?)^\}/gm)) {
    const [, name, body] = match;
    if (name && body && /^ {2}\w+\??\([^]*?\):/m.test(body)) ports.push(name);
  }
  return ports;
}

const ports = files
  .filter(({ path }) => /[\\/]aplicacion[\\/]/.test(path))
  .flatMap(({ content }) => portsIn(content));
const known = new Set(ports);

const adapters = files
  .filter(({ path }) => /[\\/]adaptadores[\\/]/.test(path))
  .flatMap(({ content }) =>
    [...content.matchAll(/^export class (\w+) implements ([\w, ]+)/gm)]
      .filter((match) => (match[2] ?? '').split(',').some((port) => known.has(port.trim())))
      .map((match) => match[1] ?? ''),
  );

const mentioned = (name: string) => new RegExp(`\\b${name}\\b`).test(CATALOG);

describe('catálogo de puertos y adaptadores', () => {
  it('reconoce los puertos del código', () => {
    expect(ports.length).toBeGreaterThan(30);
    expect(adapters.length).toBeGreaterThan(20);
  });

  it('cada puerto figura en el catálogo', () => {
    expect(ports.filter((port) => !mentioned(port))).toEqual([]);
  });

  it('cada adaptador figura en el catálogo', () => {
    expect(adapters.filter((adapter) => !mentioned(adapter))).toEqual([]);
  });
});
