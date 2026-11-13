import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import { MAX_FILE_BYTES, TEMPLATES } from '../dominio/templates.js';
import { XlsxSpreadsheet } from './xlsx.js';

const xlsx = new XlsxSpreadsheet();

// Libro mínimo armado a mano: permite probar fórmulas con su valor guardado y macros.
function workbook(sheetXml: string, extra: Record<string, string> = {}, macro = false) {
  const contentType = macro
    ? 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${contentType}"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetXml}</sheetData></worksheet>`,
    ),
    ...Object.fromEntries(Object.entries(extra).map(([name, text]) => [name, strToU8(text)])),
  });
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ApplicationError) return error.code;
    throw error;
  }
  return null;
};

describe('[RF-174] lectura de archivos Excel en el servidor', () => {
  it('la plantilla descargada se vuelve a leer con su encabezado', async () => {
    const template = await xlsx.template('Productos', TEMPLATES.productos);
    expect(await xlsx.firstSheet(template)).toEqual([[...TEMPLATES.productos]]);
  });

  it('una fórmula se lee por el valor que guardó Excel y nunca se evalúa', async () => {
    const file = workbook(
      '<row r="1"><c r="A1"><v>21</v></c><c r="B1"><f>A1*2</f><v>42</v></c><c r="C1"><f>WEBSERVICE("http://x")</f><v>0</v></c></row>',
    );
    expect(await xlsx.firstSheet(file)).toEqual([[21, 42, 0]]);
  });

  it('un archivo con macros se rechaza completo', async () => {
    const withMacros = workbook('<row r="1"><c r="A1"><v>1</v></c></row>', {
      'xl/vbaProject.bin': 'x',
    });
    expect(await codeOf(xlsx.firstSheet(withMacros))).toBe('ARCHIVO_CON_MACROS');
    const macroEnabled = workbook('<row r="1"><c r="A1"><v>1</v></c></row>', {}, true);
    expect(await codeOf(xlsx.firstSheet(macroEnabled))).toBe('ARCHIVO_CON_MACROS');
  });

  it.each([
    [
      'de Excel 97-2003',
      new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      'FORMATO_ANTERIOR',
    ],
    ['de texto', strToU8('codigo;nombre\n1;Agua'), 'ARCHIVO_INVALIDO'],
    [
      'comprimido pero dañado',
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]),
      'ARCHIVO_INVALIDO',
    ],
    ['comprimido sin libro', zipSync({ 'hola.txt': strToU8('hola') }), 'ARCHIVO_INVALIDO'],
    ['de más de 5 MB', new Uint8Array(MAX_FILE_BYTES + 1), 'ARCHIVO_DEMASIADO_GRANDE'],
  ])('un archivo %s se rechaza', async (_case, file, code) => {
    expect(await codeOf(xlsx.firstSheet(file))).toBe(code);
  });
});
