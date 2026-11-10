// Dos niveles de información (T-262 a T-266; D-96): ninguna tabla de primer nivel muestra más de 5
// datos por fila. La columna de acciones no es un dato. Lo demás va al panel de detalle.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const PAGES = join(ROOT, 'apps/frontend/src');
const MAX_DATA = 5;

function screens(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return screens(path);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : [];
  });
}

// Encabezados de cada tabla: el texto de cada celda de <TableHead>.
function tableHeaders(source: string): string[][] {
  return [...source.matchAll(/<TableHead>([\s\S]*?)<\/TableHead>/g)].map((match) =>
    [...(match[1] ?? '').matchAll(/<TableCell[^>]*>([^<]*)<\/TableCell>|<TableCell[^>]*\/>/g)].map(
      (cell) => (cell[1] ?? '').trim(),
    ),
  );
}

const tables = screens(PAGES).flatMap((path) =>
  tableHeaders(readFileSync(path, 'utf8')).map((headers) => ({
    file: relative(ROOT, path).split('\\').join('/'),
    headers,
  })),
);

describe('[RF-192] primer nivel despejado', () => {
  it('hay tablas que revisar', () => {
    expect(tables.length).toBeGreaterThan(20);
  });

  it.each(tables)('$file: $headers', ({ headers }) => {
    const data = headers.filter((h) => h !== 'Acciones' && h !== '');
    expect(data.length).toBeLessThanOrEqual(MAX_DATA);
  });

  it('cuenta las celdas de un encabezado', () => {
    expect(
      tableHeaders(
        '<TableHead><TableRow><TableCell>A</TableCell><TableCell align="right">B</TableCell><TableCell /></TableRow></TableHead>',
      ),
    ).toEqual([['A', 'B', '']]);
  });
});
