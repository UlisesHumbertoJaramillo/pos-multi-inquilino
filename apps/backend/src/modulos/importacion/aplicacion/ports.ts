// Puertos de la carga desde Excel (T-290 a T-295; plan §2.20, AD-27).
import type { Cell } from '../dominio/templates.js';

export interface ImportActor {
  tenantId: string;
  userId: string;
  at: Date;
}

// Lee y valida el archivo en el servidor: formato, macros, tamaño y fórmulas por su valor.
export interface SpreadsheetReader {
  // Las celdas de la primera hoja. Un archivo que no se puede cargar se rechaza completo.
  firstSheet(file: Uint8Array): Promise<Cell[][]>;
}

// Arma la plantilla descargable de cada tipo de carga.
export interface SpreadsheetWriter {
  template(sheet: string, headers: readonly string[]): Promise<Uint8Array>;
}

type Outcome =
  | { line: number; key: string; outcome: 'creado' | 'actualizado' }
  | { line: number; key: string; outcome: 'error'; reason: string };

// Lo provee el catálogo: los productos pasan por la misma importación que el CSV de un proveedor,
// con el recálculo de precios (RF-035, RF-032).
export interface ProductRows {
  importRows(
    actor: ImportActor,
    rows: readonly {
      line: number;
      barcode: string;
      name: string;
      cost: string;
      category: string;
    }[],
  ): Promise<{
    outcomes: (
      | { line: number; barcode: string; outcome: 'creado' | 'actualizado' }
      | { line: number; barcode: string; outcome: 'error'; reason: string }
    )[];
  }>;
}

// Lo provee proveedores: identifica por CUIT y nunca toca el saldo.
export interface SupplierRows {
  importRows(
    actor: ImportActor,
    rows: readonly { line: number; cuit: string; name: string; contact: string }[],
  ): Promise<Outcome[]>;
}

// Lo provee el catálogo: precios en listas de precio fijo, con su historial.
export interface PriceRows {
  importRows(
    actor: ImportActor,
    rows: readonly { line: number; list: string; barcode: string; price: string }[],
  ): Promise<Outcome[]>;
}
