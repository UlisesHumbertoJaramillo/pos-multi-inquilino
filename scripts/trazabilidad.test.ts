import { describe, expect, it } from 'vitest';
import {
  collectReferences,
  parseRequirements,
  renderTable,
  strictProblems,
} from './trazabilidad.js';

const SPEC = [
  '### 5.1 Aislamiento, seguridad y acceso',
  '',
  '| RF | Requisito | Origen |',
  '| :-- | :-- | :-- |',
  '| RF-001 | El sistema deberá restringir los datos al comercio. | RN-01 |',
  '| RF-002 | Si un usuario pide datos de otro comercio, se rechaza. | RN-01 |',
  '### 5.3 Auditoría y retención',
  '| RF-020 | Las bajas son lógicas. | RN-02 |',
].join('\n');

describe('modo estricto con RF pendientes', () => {
  const requirements = parseRequirements(SPEC);
  const tested = collectReferences([{ path: 'a.test.ts', content: "it('[RF-001] x', () => {});" }]);

  it('un RF sin pruebas falla, salvo que esté pendiente con su tarea', () => {
    expect(strictProblems(requirements, tested, {})).toEqual(['RF sin pruebas: RF-002, RF-020.']);
    expect(strictProblems(requirements, tested, { 'RF-002': 'T-1', 'RF-020': 'T-2' })).toEqual([]);
  });

  it('un pendiente que ya tiene pruebas o que no existe se informa', () => {
    expect(
      strictProblems(requirements, tested, {
        'RF-001': 'T-1',
        'RF-002': 'T-1',
        'RF-020': 'T-1',
        'RF-999': 'T-9',
      }),
    ).toEqual([
      'Ya tienen pruebas, sacalos de sdd/rf-pendientes.json: RF-001.',
      'Pendientes que no existen en el spec: RF-999.',
    ]);
  });
});

describe('trazabilidad', () => {
  it('lee los RF del spec con su sección', () => {
    expect(parseRequirements(SPEC)).toStrictEqual([
      {
        id: 'RF-001',
        section: '§5.1',
        text: 'El sistema deberá restringir los datos al comercio.',
      },
      {
        id: 'RF-002',
        section: '§5.1',
        text: 'Si un usuario pide datos de otro comercio, se rechaza.',
      },
      { id: 'RF-020', section: '§5.3', text: 'Las bajas son lógicas.' },
    ]);
  });

  it('asocia cada etiqueta con el archivo y el título de la prueba', () => {
    const references = collectReferences([
      {
        path: 'apps/backend/test/a.int.test.ts',
        content:
          "describe('[RF-001] [RF-002] aislamiento', () => {\n  it('[RF-001] rechaza', () => {});\n});",
      },
    ]);

    expect(references.get('RF-001')).toStrictEqual([
      { file: 'apps/backend/test/a.int.test.ts', title: '[RF-001] [RF-002] aislamiento' },
      { file: 'apps/backend/test/a.int.test.ts', title: '[RF-001] rechaza' },
    ]);
    expect(references.get('RF-002')).toHaveLength(1);
  });

  it('genera una fila por RF, con guion si no tiene pruebas, y la cobertura', () => {
    const requirements = parseRequirements(SPEC);
    const references = collectReferences([
      { path: 'apps/backend/test/b.int.test.ts', content: "it('[RF-020] baja lógica', () => {});" },
    ]);

    const table = renderTable(requirements, references);

    expect(table).toContain('**Cobertura:** 1 de 3 RF con al menos una prueba.');
    expect(table).toContain(
      '| RF-001 | §5.1 | El sistema deberá restringir los datos al comercio. | — |',
    );
    expect(table).toContain(
      '| RF-020 | §5.3 | Las bajas son lógicas. | [b.int.test.ts](../apps/backend/test/b.int.test.ts): [RF-020] baja lógica |',
    );
  });
});
