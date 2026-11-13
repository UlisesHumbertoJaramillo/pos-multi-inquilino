// Plantillas de la carga desde Excel (T-291, T-292; RF-170 a RF-174, D-98). Cada tipo de carga
// tiene sus columnas fijas, en este orden, en la primera hoja. Las filas vacías se ignoran y cada
// fila conserva su número de la planilla, para que los rechazos se encuentren fácil.
import { DomainError } from '../../../compartido/dominio/errors.js';

export const IMPORT_KINDS = ['productos', 'proveedores', 'precios'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const TEMPLATES: Record<ImportKind, readonly string[]> = {
  productos: ['Código de barras', 'Nombre', 'Categoría', 'Costo sin IVA'],
  proveedores: ['CUIT', 'Razón social', 'Contacto'],
  precios: ['Lista', 'Código de barras', 'Precio final'],
};

export const MAX_ROWS = 5000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type Cell = string | number | boolean | Date | null;

export interface SheetRow {
  // Número de la fila en la planilla (la del encabezado es la 1).
  line: number;
  values: string[];
}

// Encabezados comparados sin mayúsculas, acentos ni espacios de más.
const plain = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('es');

// Texto de una celda. Los números se escriben sin separadores de miles y con punto decimal.
export function cellText(cell: Cell): string {
  if (cell === null) return '';
  if (typeof cell === 'number') return Number.isInteger(cell) ? String(cell) : String(cell);
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

// Valida el encabezado de la plantilla y devuelve las filas con datos.
export function sheetRows(kind: ImportKind, rows: readonly (readonly Cell[])[]): SheetRow[] {
  const expected = TEMPLATES[kind];
  const header = (rows[0] ?? []).map((cell) => plain(cellText(cell)));
  const matches = expected.every((title, i) => header[i] === plain(title));
  if (!matches) {
    throw new DomainError(
      'PLANTILLA_INVALIDA',
      `La primera fila tiene que tener las columnas ${expected.map((t) => `«${t}»`).join(', ')}, en ese orden. Descargá la plantilla y completala.`,
    );
  }
  const data = rows
    .slice(1)
    .map((cells, index) => ({
      line: index + 2,
      values: expected.map((_, i) => cellText(cells[i] ?? null)),
    }))
    .filter((row) => row.values.some((value) => value !== ''));
  if (data.length === 0) {
    throw new DomainError('PLANILLA_VACIA', 'La planilla no tiene filas para cargar.');
  }
  if (data.length > MAX_ROWS) {
    throw new DomainError(
      'DEMASIADAS_FILAS',
      `La planilla tiene ${String(data.length)} filas: se cargan hasta ${String(MAX_ROWS)} por archivo.`,
    );
  }
  return data;
}

// Resultado de una fila, igual para los tres tipos de carga.
export type RowOutcome =
  | { line: number; key: string; outcome: 'creado' | 'actualizado' }
  | { line: number; key: string; outcome: 'error'; reason: string };

export interface ImportSummary {
  created: number;
  updated: number;
  rejected: number;
  rows: RowOutcome[];
}

export function summarize(rows: readonly RowOutcome[]): ImportSummary {
  return {
    created: rows.filter((r) => r.outcome === 'creado').length,
    updated: rows.filter((r) => r.outcome === 'actualizado').length,
    rejected: rows.filter((r) => r.outcome === 'error').length,
    rows: [...rows].sort((a, b) => a.line - b.line),
  };
}
