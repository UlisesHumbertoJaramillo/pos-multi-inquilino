// Adaptador de Excel (T-290; RF-174, AD-27): solo libros .xlsx, sin macros, de hasta 5 MB y que
// descomprimidos no pasen de 50 MB. Las fórmulas se leen por el valor que Excel guardó: nunca se
// evalúan. Cualquier otro archivo se rechaza completo, con un motivo que se entiende.
import { unzipSync } from 'fflate';
import readXlsxFile from 'read-excel-file/node';
import writeXlsxFile from 'write-excel-file/node';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import type { SpreadsheetReader, SpreadsheetWriter } from '../aplicacion/ports.js';
import { type Cell, MAX_FILE_BYTES } from '../dominio/templates.js';

const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const ZIP = [0x50, 0x4b, 0x03, 0x04];
// Formato binario de Excel 97-2003 (.xls).
const OLE = [0xd0, 0xcf, 0x11, 0xe0];

const startsWith = (file: Uint8Array, signature: number[]) =>
  signature.every((byte, i) => file[i] === byte);

const reject = (code: string, message: string) =>
  new ApplicationError('invalid_request', code, message);

export class XlsxSpreadsheet implements SpreadsheetReader, SpreadsheetWriter {
  async firstSheet(file: Uint8Array): Promise<Cell[][]> {
    if (file.length > MAX_FILE_BYTES) {
      throw reject('ARCHIVO_DEMASIADO_GRANDE', 'El archivo pasa de 5 MB.');
    }
    if (startsWith(file, OLE)) {
      throw reject(
        'FORMATO_ANTERIOR',
        'El archivo es de una versión anterior de Excel: guardalo como «Libro de Excel (.xlsx)».',
      );
    }
    if (!startsWith(file, ZIP)) {
      throw reject('ARCHIVO_INVALIDO', 'El archivo no es un libro de Excel (.xlsx).');
    }

    // Se recorre el índice del archivo sin descomprimir: nombres y tamaños.
    const names: string[] = [];
    let uncompressed = 0;
    let contentTypes: string;
    try {
      const entries = unzipSync(file, {
        filter: (entry) => {
          names.push(entry.name);
          uncompressed += entry.originalSize;
          return entry.name === '[Content_Types].xml';
        },
      });
      contentTypes = new TextDecoder().decode(entries['[Content_Types].xml']);
    } catch {
      throw reject('ARCHIVO_INVALIDO', 'El archivo está dañado o no es un libro de Excel.');
    }
    if (uncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw reject('ARCHIVO_DEMASIADO_GRANDE', 'El contenido del archivo es demasiado grande.');
    }
    if (
      names.some((n) => n.toLowerCase().endsWith('vbaproject.bin')) ||
      /macroEnabled/i.test(contentTypes)
    ) {
      throw reject(
        'ARCHIVO_CON_MACROS',
        'El archivo tiene macros: guardalo como «Libro de Excel (.xlsx)», sin macros.',
      );
    }
    if (!names.includes('xl/workbook.xml')) {
      throw reject('ARCHIVO_INVALIDO', 'El archivo no es un libro de Excel (.xlsx).');
    }
    try {
      const sheets = await readXlsxFile(Buffer.from(file));
      return (sheets[0]?.data ?? []) as Cell[][];
    } catch {
      throw reject('ARCHIVO_INVALIDO', 'No se pudo leer el libro de Excel: puede estar dañado.');
    }
  }

  async template(sheet: string, headers: readonly string[]): Promise<Uint8Array> {
    const buffer = await writeXlsxFile(
      [headers.map((value) => ({ value, fontWeight: 'bold' as const }))],
      {
        sheet,
        columns: headers.map(() => ({ width: 24 })),
      },
    ).toBuffer();
    return new Uint8Array(buffer);
  }
}
