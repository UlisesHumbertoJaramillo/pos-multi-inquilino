import { describe, expect, it } from 'vitest';
import { theme, TOUCH_TARGET_PX } from './theme';

const TOUCH = '@media (pointer: coarse)';

type Overrides = Record<
  string,
  { styleOverrides?: { root?: Record<string, { minHeight?: number }> } } | undefined
>;

const touchRule = (component: string) =>
  (theme.components as Overrides | undefined)?.[component]?.styleOverrides?.root?.[TOUCH];

describe('[RF-157] tamaño táctil mínimo', () => {
  it('en pantallas táctiles los controles tienen al menos 48 px', () => {
    expect(TOUCH_TARGET_PX).toBeGreaterThanOrEqual(48);
    for (const component of ['MuiButton', 'MuiIconButton', 'MuiListItemButton', 'MuiMenuItem']) {
      expect(touchRule(component)?.minHeight, component).toBe(TOUCH_TARGET_PX);
    }
  });

  it('los botones son grandes por defecto', () => {
    expect(theme.components?.MuiButton?.defaultProps?.size).toBe('large');
  });
});
