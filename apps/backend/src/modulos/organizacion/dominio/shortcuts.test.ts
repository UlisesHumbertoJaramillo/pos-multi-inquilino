import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../compartido/dominio/errors.js';
import {
  ASSIGNABLE_KEYS,
  DEFAULT_SHORTCUTS,
  RESERVED_KEYS,
  SHORTCUT_ACTIONS,
  validateShortcuts,
} from './shortcuts.js';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error: unknown) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return null;
};

// Mitad derecha del teclado: el teclado numérico, el bloque de edición, Enter y las teclas de
// función de la derecha. La mitad izquierda no aparece en la distribución por defecto.
const RIGHT_HAND = new Set([
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
  'NumpadDivide',
  'Enter',
  'Insert',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'F8',
  'F9',
  'Escape',
]);

describe('[RF-182] [RF-185] atajos del POS', () => {
  it('la distribución por defecto es válida, cubre todas las acciones y es de la mano derecha', () => {
    expect(validateShortcuts({})).toStrictEqual(DEFAULT_SHORTCUTS);
    expect(Object.keys(DEFAULT_SHORTCUTS).sort()).toEqual([...SHORTCUT_ACTIONS].sort());
    for (const key of Object.values(DEFAULT_SHORTCUTS)) expect(RIGHT_HAND.has(key), key).toBe(true);
  });

  it('ningún dígito, letra ni la coma pueden ser atajos: son datos', () => {
    for (const key of ['Numpad1', 'Digit5', 'NumpadDecimal', 'KeyA', 'Comma', 'ArrowUp', 'Tab']) {
      expect(
        codeOf(() => validateShortcuts({ cobrar: key })),
        key,
      ).toBe('ATAJO_NO_PERMITIDO');
    }
  });

  it.each([
    ['repetida', { cobrar: 'F9' }, 'ATAJO_REPETIDO'],
    ['reservada por el navegador', { corte_x: 'F5' }, 'ATAJO_RESERVADO'],
    ['que requiere las dos manos', { cobrar: 'Control+F2' }, 'ATAJO_COMBINADO'],
    ['de una acción desconocida', { borrar_todo: 'F2' }, 'ATAJO_ACCION_DESCONOCIDA'],
  ] as const)('una tecla %s se rechaza', (_case, input, code) => {
    expect(codeOf(() => validateShortcuts(input))).toBe(code);
  });

  it('el navegador reserva sus teclas y ninguna se puede asignar', () => {
    for (const key of RESERVED_KEYS) {
      expect((ASSIGNABLE_KEYS as readonly string[]).includes(key)).toBe(false);
    }
  });

  it('una acción puede quedar sin atajo y otra tomar su tecla, como en una notebook', () => {
    const map = validateShortcuts({ cobrar: 'F2', descuento: null, cantidad: 'Delete' });
    expect(map).toMatchObject({ cobrar: 'F2', descuento: null, cantidad: 'Delete' });
  });
});
