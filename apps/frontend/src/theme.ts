// Sistema visual único (AD-30; RF-188, RF-193): Material Design con modo claro y oscuro, y paneles
// de vidrio sutiles (CLAUDE.md). Es el único lugar donde se definen colores: una regla de lint
// impide escribirlos en las pantallas (T-254).
import { createTheme, type Theme } from '@mui/material/styles';

// Tamaño táctil mínimo (RF-157, T-242): en pantallas táctiles, ningún control queda por debajo de
// 48 px. En escritorio, con mouse, la administración conserva su densidad.
export const TOUCH_TARGET_PX = 48;
const TOUCH_MEDIA = '@media (pointer: coarse)';

// Niveles de severidad de D-99, con un significado único en todo el sistema.
export const SEVERITIES = ['critica', 'advertencia', 'informativa', 'correcta'] as const;
export type Severity = (typeof SEVERITIES)[number];

// Color de la paleta de Material que representa cada nivel.
export const SEVERITY_PALETTE: Record<Severity, 'error' | 'warning' | 'info' | 'success'> = {
  critica: 'error',
  advertencia: 'warning',
  informativa: 'info',
  correcta: 'success',
};

export const SEVERITY_NAMES: Record<Severity, string> = {
  critica: 'Crítica',
  advertencia: 'Advertencia',
  informativa: 'Informativa',
  correcta: 'Correcta',
};

// Paleta: azul petróleo de marca sobre fondos fríos; los cuatro niveles cumplen 4,5:1 sobre el
// papel de cada modo.
export const PALETTE = {
  light: {
    primary: '#0e6178',
    secondary: '#46607a',
    critica: '#c62828',
    advertencia: '#9a5b00',
    informativa: '#1f5fbf',
    correcta: '#2e7d32',
    background: '#f4f7f8',
    paper: '#ffffff',
    text: '#1a2a33',
    textSecondary: '#4f6470',
  },
  dark: {
    primary: '#6fc3d6',
    secondary: '#a7bccd',
    critica: '#ff8a80',
    advertencia: '#ffb74d',
    informativa: '#8ab4f8',
    correcta: '#81c784',
    background: '#0d1a1f',
    paper: '#13242b',
    text: '#e6eef1',
    textSecondary: '#a9bcc4',
  },
} as const;

// Papel impreso (listas de precios): siempre negro sobre blanco, sin importar el modo.
export const PRINT = { paper: '#ffffff', ink: '#000000', rule: '#cccccc' } as const;

const FONT = '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif';

function scheme(p: (typeof PALETTE)['light' | 'dark']) {
  return {
    palette: {
      primary: { main: p.primary },
      secondary: { main: p.secondary },
      error: { main: p.critica },
      warning: { main: p.advertencia },
      info: { main: p.informativa },
      success: { main: p.correcta },
      background: { default: p.background, paper: p.paper },
      text: { primary: p.text, secondary: p.textSecondary },
    },
  };
}

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: { light: scheme(PALETTE.light), dark: scheme(PALETTE.dark) },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: FONT,
    h4: { fontSize: '1.75rem', fontWeight: 600, lineHeight: 1.25 },
    h5: { fontSize: '1.375rem', fontWeight: 600, lineHeight: 1.3 },
    h6: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.35 },
    subtitle1: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
  },
  components: {
    MuiCssBaseline: {
      // Importes y cantidades alineados en columnas.
      styleOverrides: { body: { fontVariantNumeric: 'tabular-nums' } },
    },
    MuiButton: {
      // Botones cómodos para pantallas táctiles.
      defaultProps: { size: 'large', disableElevation: true },
      styleOverrides: { root: { [TOUCH_MEDIA]: { minHeight: TOUCH_TARGET_PX } } },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { [TOUCH_MEDIA]: { minHeight: TOUCH_TARGET_PX, minWidth: TOUCH_TARGET_PX } },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 8, fontWeight: 500, [TOUCH_MEDIA]: { minHeight: 40 } },
      },
    },
    MuiPaper: {
      styleOverrides: { rounded: { borderRadius: 16 } },
    },
    MuiTableCell: {
      styleOverrides: {
        head: ({ theme: t }) => ({ color: t.palette.text.secondary, fontWeight: 600 }),
      },
    },
    MuiListItemButton: {
      styleOverrides: { root: { borderRadius: 8, [TOUCH_MEDIA]: { minHeight: TOUCH_TARGET_PX } } },
    },
    MuiMenuItem: {
      styleOverrides: { root: { [TOUCH_MEDIA]: { minHeight: TOUCH_TARGET_PX } } },
    },
  },
});

// Superficie de vidrio para barras y paneles flotantes, en modo claro y oscuro.
export function glassSurface(t: Theme) {
  return {
    backdropFilter: 'blur(14px) saturate(160%)',
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    border: '1px solid rgba(14, 97, 120, 0.12)',
    ...t.applyStyles('dark', {
      backgroundColor: 'rgba(19, 36, 43, 0.78)',
      border: '1px solid rgba(111, 195, 214, 0.12)',
    }),
  };
}

// Fondo de las pantallas: un velo frío del color de marca que hace visible el vidrio.
export function pageBackground(t: Theme) {
  return {
    minHeight: '100vh',
    background: `radial-gradient(circle at 12% 0%, #d6edf2 0, transparent 42%), radial-gradient(circle at 92% 100%, #e3e9f4 0, transparent 38%), ${PALETTE.light.background}`,
    ...t.applyStyles('dark', {
      background: `radial-gradient(circle at 12% 0%, #12343d 0, transparent 42%), radial-gradient(circle at 92% 100%, #1a2238 0, transparent 38%), ${PALETTE.dark.background}`,
    }),
  };
}
