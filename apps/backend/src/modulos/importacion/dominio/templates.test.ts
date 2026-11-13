import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../compartido/dominio/errors.js';
import { MAX_ROWS, sheetRows, summarize, TEMPLATES } from './templates.js';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error: unknown) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return null;
};

describe('[RF-173] [RF-174] plantillas de la carga desde Excel', () => {
  it('lee las filas con su número y los números como texto con punto decimal', () => {
    const rows = sheetRows('productos', [
      ['Código de barras', 'Nombre', 'Categoría', 'Costo sin IVA'],
      ['7790001', 'Agua', 'Bebidas', 450.5],
      [null, null, null, null],
      ['7790002', 'Yerba', 'Almacén', 3100],
    ]);
    expect(rows).toEqual([
      { line: 2, values: ['7790001', 'Agua', 'Bebidas', '450.5'] },
      { line: 4, values: ['7790002', 'Yerba', 'Almacén', '3100'] },
    ]);
  });

  it('acepta el encabezado sin acentos ni mayúsculas', () => {
    expect(
      sheetRows('proveedores', [
        ['cuit', 'RAZON SOCIAL', ' contacto '],
        ['1', 'A', null],
      ]),
    ).toHaveLength(1);
  });

  it.each([
    [
      'columnas en otro orden',
      [['Nombre', 'Código de barras', 'Categoría', 'Costo sin IVA'], ['a']],
      'PLANTILLA_INVALIDA',
    ],
    ['la plantilla de otro tipo', [[...TEMPLATES.precios], ['a', 'b', 1]], 'PLANTILLA_INVALIDA'],
    ['una planilla sin filas', [[...TEMPLATES.productos]], 'PLANILLA_VACIA'],
  ])('rechaza %s', (_case, rows, code) => {
    expect(codeOf(() => sheetRows('productos', rows))).toBe(code);
  });

  it(`rechaza más de ${String(MAX_ROWS)} filas`, () => {
    const rows = [
      [...TEMPLATES.proveedores],
      ...Array.from({ length: MAX_ROWS + 1 }, () => ['1', 'A', null]),
    ];
    expect(codeOf(() => sheetRows('proveedores', rows))).toBe('DEMASIADAS_FILAS');
  });

  it('resume cuánto se crea, se actualiza y se rechaza, por número de fila', () => {
    expect(
      summarize([
        { line: 3, key: 'b', outcome: 'error', reason: 'x' },
        { line: 2, key: 'a', outcome: 'creado' },
        { line: 4, key: 'c', outcome: 'actualizado' },
      ]),
    ).toMatchObject({
      created: 1,
      updated: 1,
      rejected: 1,
      rows: [{ line: 2 }, { line: 3 }, { line: 4 }],
    });
  });
});
