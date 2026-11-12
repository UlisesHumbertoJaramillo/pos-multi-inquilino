// Atajos de teclado (T-275; RF-181 a RF-184, D-100). El mapa lo da el backend con los atajos del
// comercio; el frontend solo traduce teclas en acciones de la pantalla. Reglas:
// - un atajo nunca se dispara en un campo de texto libre ni en el diálogo del PIN;
// - en la búsqueda y en los importes sí, salvo Enter y Esc, que conservan su uso en el campo;
// - una tecla con Ctrl, Alt o Meta nunca es un atajo.
import type { ShortcutAction, Shortcuts } from '@pos/contracts';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/AuthContext';
import { focusKind, matchesKey } from './keys';

export type ShortcutMap = Partial<Record<ShortcutAction, string | null>>;

interface ShortcutsValue {
  map: ShortcutMap;
  names: Partial<Record<ShortcutAction, string>>;
}

// Fuera del POS solo se confirman y cancelan diálogos, con las teclas de siempre.
const BASIC: ShortcutsValue = { map: { confirmar: 'Enter', cancelar: 'Escape' }, names: {} };

const ShortcutsContext = createContext<ShortcutsValue>(BASIC);

export function useShortcutMap(): ShortcutsValue {
  return useContext(ShortcutsContext);
}

// Carga los atajos del comercio para el POS. Los demás roles usan los básicos.
export function ShortcutsProvider({ pos, children }: { pos: boolean; children: ReactNode }) {
  const { request } = useAuth();
  const [value, setValue] = useState<ShortcutsValue>(BASIC);
  useEffect(() => {
    if (!pos) return;
    let cancelled = false;
    request<Shortcuts>('/atajos').then(
      (shortcuts) => {
        if (cancelled) return;
        setValue({
          map: Object.fromEntries(shortcuts.atajos.map((a) => [a.accion, a.tecla])),
          names: Object.fromEntries(shortcuts.atajos.map((a) => [a.accion, a.nombre])),
        });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [pos, request]);
  return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>;
}

export type ShortcutHandlers = Partial<Record<ShortcutAction, () => void>>;

// Escucha los atajos de una pantalla mientras está habilitada.
export function useShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  const { map } = useShortcutMap();
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  const entries = useMemo(
    () =>
      Object.entries(map).filter((entry): entry is [ShortcutAction, string] => entry[1] !== null),
    [map],
  );
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      const kind = focusKind(event.target);
      if (kind === 'bloqueado' || kind === 'texto') return;
      if (kind === 'datos' && (event.code === 'Escape' || matchesKey(event, 'Enter'))) return;
      const match = entries.find(([, key]) => matchesKey(event, key));
      if (!match) return;
      const handler = latest.current[match[0]];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [enabled, entries]);
}

// Enter confirma la acción principal del diálogo abierto (RF-194): el botón marcado con
// data-confirmar o, si no hay, el botón destacado de sus acciones. Esc ya lo cierra el diálogo.
export function useDialogConfirm(): void {
  const { map } = useShortcutMap();
  const key = map.confirmar ?? null;
  useEffect(() => {
    if (key === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matchesKey(event, key)) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return;
      if (target.getAttribute('aria-expanded') === 'true') return;
      // Al abrirse, el diálogo deja el foco en su contenedor, que envuelve al diálogo.
      const dialog = target.closest('[role="dialog"]') ?? target.querySelector('[role="dialog"]');
      if (!dialog) return;
      const button =
        dialog.querySelector<HTMLButtonElement>('button[data-confirmar]') ??
        dialog.querySelector<HTMLButtonElement>(
          '.MuiDialogActions-root button.MuiButton-contained',
        );
      if (!button || button.disabled) return;
      event.preventDefault();
      button.click();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [key]);
}
