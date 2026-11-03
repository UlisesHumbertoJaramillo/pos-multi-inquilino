// Lectura del CSV de catálogo de un proveedor (T-106; RF-035, D-49). Columnas, con encabezado:
// codigo_barras, nombre, costo, categoria. El separador es coma o punto y coma (el que usa Excel
// en español); con punto y coma, el costo puede usar coma decimal. Las validaciones de cada fila
// las hace el catálogo, que informa el motivo de las que rechaza.
import { DomainError } from '../../../compartido/dominio/errors.js';

export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
export const IMPORT_COLUMNS = ['codigo_barras', 'nombre', 'costo', 'categoria'] as const;

export interface CsvRow {
  line: number;
  barcode: string;
  name: string;
  cost: string;
  category: string;
}

export interface CsvRowError {
  line: number;
  barcode: string;
  reason: string;
}

// Separa una línea respetando las comillas ("Galletitas ""dulces""", con separador adentro).
function splitLine(line: string, separator: string): string[] | null {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line.charAt(i);
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"' && current.trim() === '') {
      quoted = true;
      current = '';
    } else if (char === separator) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (quoted) return null;
  fields.push(current.trim());
  return fields;
}

// Encabezado sin tildes, may\u00fasculas ni espacios: \u00abC\u00f3digo de barras\u00bb es codigo_barras.
const normalizeHeader = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_de_/g, '_');

export function parseCatalogCsv(text: string): { rows: CsvRow[]; errors: CsvRowError[] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = lines[0] ?? '';
  const separator = header.includes(';') ? ';' : ',';
  const columns = (splitLine(header, separator) ?? []).map(normalizeHeader);
  const index = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, columns.indexOf(c)])) as Record<
    (typeof IMPORT_COLUMNS)[number],
    number
  >;
  if (Object.values(index).some((i) => i < 0)) {
    throw new DomainError(
      'CSV_INVALIDO',
      `El archivo tiene que tener un encabezado con las columnas ${IMPORT_COLUMNS.join(', ')}.`,
    );
  }
  const dataLines = lines.slice(1);
  if (dataLines.filter((l) => l.trim() !== '').length > MAX_IMPORT_ROWS) {
    throw new DomainError(
      'CSV_INVALIDO',
      `El archivo tiene más de ${String(MAX_IMPORT_ROWS)} filas.`,
    );
  }

  const rows: CsvRow[] = [];
  const errors: CsvRowError[] = [];
  dataLines.forEach((raw, i) => {
    const line = i + 2;
    if (raw.trim() === '') return;
    const fields = splitLine(raw, separator);
    const field = (name: (typeof IMPORT_COLUMNS)[number]) => fields?.[index[name]] ?? '';
    if (fields === null || fields.length < columns.length) {
      errors.push({
        line,
        barcode: field('codigo_barras'),
        reason: 'La fila no tiene todas las columnas.',
      });
      return;
    }
    // Con punto y coma, "1.250,50" es 1250.50; sin coma, el valor se toma tal cual.
    const rawCost = field('costo');
    const cost =
      separator === ';' && rawCost.includes(',')
        ? rawCost.replace(/\./g, '').replace(',', '.')
        : rawCost;
    rows.push({
      line,
      barcode: field('codigo_barras'),
      name: field('nombre'),
      cost,
      category: field('categoria'),
    });
  });
  return { rows, errors };
}
