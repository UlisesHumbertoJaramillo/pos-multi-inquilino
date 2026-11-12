// Teclas de los atajos (D-94, D-100). Se identifican por su posición física (`KeyboardEvent.code`):
// el mapa no depende de la distribución del teclado. Qué tecla tiene cada acción lo decide el
// backend; acá solo se compara y se muestra.

// Nombre visible de cada tecla, como está impresa en un teclado en español.
export const KEY_LABELS: Record<string, string> = {
  NumpadAdd: '+',
  NumpadSubtract: '−',
  NumpadMultiply: '*',
  NumpadDivide: '/',
  Enter: 'Enter',
  Escape: 'Esc',
  Insert: 'Insert',
  Delete: 'Supr',
  Home: 'Inicio',
  End: 'Fin',
  PageUp: 'RePág',
  PageDown: 'AvPág',
  F2: 'F2',
  F4: 'F4',
  F8: 'F8',
  F9: 'F9',
};

export const keyLabel = (code: string) => KEY_LABELS[code] ?? code;

// Enter vale igual en el teclado principal y en el numérico.
export function matchesKey(event: KeyboardEvent, code: string): boolean {
  if (code === 'Enter') return event.code === 'Enter' || event.code === 'NumpadEnter';
  return event.code === code;
}

// Dónde está el foco, para decidir si una tecla es un atajo:
// - bloqueado: dentro del PIN u otra zona marcada con data-atajos="no";
// - datos: la búsqueda del POS o un importe (data-atajos="datos"), donde los operadores del
//   teclado numérico nunca forman parte de lo escrito;
// - texto: cualquier otro campo, donde se escribe libremente y no hay atajos;
// - libre: fuera de los campos.
export type FocusKind = 'bloqueado' | 'datos' | 'texto' | 'libre';

export function focusKind(target: EventTarget | null): FocusKind {
  if (!(target instanceof HTMLElement)) return 'libre';
  if (target.closest('[data-atajos="no"]')) return 'bloqueado';
  const editable =
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
  if (!editable) return 'libre';
  return target.closest('[data-atajos="datos"]') ? 'datos' : 'texto';
}
