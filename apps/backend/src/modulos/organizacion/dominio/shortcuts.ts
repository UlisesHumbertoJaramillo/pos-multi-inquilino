// Atajos de teclado del POS (T-273; RF-181 a RF-185, D-94, D-100, AD-28). El POS se opera con la
// mano derecha sobre el teclado numérico: cada acción tiene una tecla por defecto y el AC puede
// cambiarla para todo su comercio. Las teclas se identifican por su posición física (el `code` del
// navegador), así el mapa no depende de la distribución del teclado.
import { DomainError } from '../../../compartido/dominio/errors.js';

export const SHORTCUT_ACTIONS = [
  'confirmar',
  'cobrar',
  'quitar_item',
  'cantidad',
  'descuento',
  'cancelar',
  'buscar',
  'ayuda',
  'venta_anterior',
  'venta_siguiente',
  'nueva_venta',
  'devolucion',
  'corte_x',
] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export const SHORTCUT_NAMES: Record<ShortcutAction, string> = {
  confirmar: 'Elegir o confirmar',
  cobrar: 'Cobrar la venta',
  quitar_item: 'Quitar el último ítem',
  cantidad: 'Cantidad del próximo producto',
  descuento: 'Descuento',
  cancelar: 'Cancelar o cerrar',
  buscar: 'Ir a la búsqueda',
  ayuda: 'Ver los atajos',
  venta_anterior: 'Venta anterior',
  venta_siguiente: 'Venta siguiente',
  nueva_venta: 'Nueva venta en paralelo',
  devolucion: 'Devolución o anulación',
  corte_x: 'Corte X',
};

// Distribución por defecto: mano derecha, teclado numérico y teclas vecinas (D-94, D-100).
export const DEFAULT_SHORTCUTS: Readonly<Record<ShortcutAction, string>> = {
  confirmar: 'Enter',
  cobrar: 'NumpadAdd',
  quitar_item: 'NumpadSubtract',
  cantidad: 'NumpadMultiply',
  descuento: 'NumpadDivide',
  cancelar: 'Escape',
  buscar: 'Home',
  ayuda: 'End',
  venta_anterior: 'PageUp',
  venta_siguiente: 'PageDown',
  nueva_venta: 'Insert',
  devolucion: 'F9',
  corte_x: 'F8',
};

// Teclas que pueden ser atajos: nunca forman parte de un código, una cantidad o un importe, y el
// navegador no las reserva. Los dígitos, la coma, las letras, las flechas (navegación) y el
// tabulador quedan para escribir y moverse.
export const ASSIGNABLE_KEYS = [
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
  'NumpadDivide',
  'Enter',
  'Escape',
  'Insert',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'F2',
  'F4',
  'F8',
  'F9',
] as const;

// Las que el navegador usa para sí (ayuda, buscar, recargar, barra de direcciones, cursor, menú,
// pantalla completa, herramientas): un atajo ahí no llegaría a la aplicación.
export const RESERVED_KEYS = ['F1', 'F3', 'F5', 'F6', 'F7', 'F10', 'F11', 'F12'] as const;

export type ShortcutMap = Record<ShortcutAction, string | null>;

const MODIFIER = /^(Control|Ctrl|Alt|Shift|Meta)\+/i;

function assertKey(action: ShortcutAction, key: string): void {
  if (MODIFIER.test(key)) {
    throw new DomainError(
      'ATAJO_COMBINADO',
      `${SHORTCUT_NAMES[action]}: un atajo es una sola tecla; una combinación puede requerir las dos manos.`,
    );
  }
  if ((RESERVED_KEYS as readonly string[]).includes(key)) {
    throw new DomainError(
      'ATAJO_RESERVADO',
      `${SHORTCUT_NAMES[action]}: el navegador reserva ${key} para sí.`,
    );
  }
  if (!(ASSIGNABLE_KEYS as readonly string[]).includes(key)) {
    throw new DomainError(
      'ATAJO_NO_PERMITIDO',
      `${SHORTCUT_NAMES[action]}: ${key} se usa para escribir o moverse, no puede ser un atajo.`,
    );
  }
}

// Valida un mapa completo: cada acción con una tecla permitida o sin atajo, y ninguna tecla
// repetida. Una acción sin atajo se sigue usando con su botón.
export function validateShortcuts(input: Partial<Record<string, string | null>>): ShortcutMap {
  const unknown = Object.keys(input).filter(
    (action) => !(SHORTCUT_ACTIONS as readonly string[]).includes(action),
  );
  if (unknown.length > 0) {
    throw new DomainError('ATAJO_ACCION_DESCONOCIDA', `Acción desconocida: ${unknown.join(', ')}.`);
  }
  const map = { ...DEFAULT_SHORTCUTS } as ShortcutMap;
  for (const action of SHORTCUT_ACTIONS) {
    const value = input[action];
    if (value === undefined) continue;
    const key = value === null ? null : value.trim();
    if (key !== null) assertKey(action, key);
    map[action] = key === '' ? null : key;
  }
  const seen = new Map<string, ShortcutAction>();
  for (const action of SHORTCUT_ACTIONS) {
    const key = map[action];
    if (key === null) continue;
    const other = seen.get(key);
    if (other !== undefined) {
      throw new DomainError(
        'ATAJO_REPETIDO',
        `${key} ya es el atajo de «${SHORTCUT_NAMES[other]}»: cada tecla puede tener una sola acción.`,
      );
    }
    seen.set(key, action);
  }
  return map;
}
