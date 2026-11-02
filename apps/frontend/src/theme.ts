// Tema Material Design con modo claro y oscuro, y paneles de vidrio sutiles (CLAUDE.md).
import { createTheme, type Theme } from '@mui/material/styles';

const BRAND = '#3554d1';

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: BRAND },
        secondary: { main: '#00897b' },
        background: { default: '#eef1f8', paper: '#ffffff' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#8fa6ff' },
        secondary: { main: '#4db6ac' },
        background: { default: '#0e1220', paper: '#161b2e' },
      },
    },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: '"Roboto", "Segoe UI", system-ui, sans-serif',
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: {
      // Botones cómodos para pantallas táctiles.
      defaultProps: { size: 'large' },
    },
  },
});

// Superficie de vidrio para barras y paneles flotantes, en modo claro y oscuro.
export function glassSurface(t: Theme) {
  return {
    backdropFilter: 'blur(14px) saturate(160%)',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    border: '1px solid rgba(255, 255, 255, 0.5)',
    ...t.applyStyles('dark', {
      backgroundColor: 'rgba(22, 27, 46, 0.72)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
    }),
  };
}

// Fondo de las pantallas: un degradé suave que hace visible el vidrio.
export function pageBackground(t: Theme) {
  return {
    minHeight: '100vh',
    background:
      'radial-gradient(circle at 15% 10%, #c7d2fe 0, transparent 45%), radial-gradient(circle at 85% 90%, #a7f3d0 0, transparent 40%), #eef1f8',
    ...t.applyStyles('dark', {
      background:
        'radial-gradient(circle at 15% 10%, #26346f 0, transparent 45%), radial-gradient(circle at 85% 90%, #0f4c45 0, transparent 40%), #0e1220',
    }),
  };
}
