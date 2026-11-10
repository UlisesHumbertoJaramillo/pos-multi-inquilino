import { getContrastRatio, ThemeProvider } from '@mui/material/styles';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PALETTE, SEVERITIES, theme } from '../theme';
import { AttentionCard } from './AttentionCard';
import { DetailPanel } from './DetailPanel';
import { Status } from './Status';

describe('[RF-188] [RF-193] niveles de severidad del tema', () => {
  it.each(['light', 'dark'] as const)(
    'en modo %s, los cuatro niveles se leen sobre el papel (4,5:1 o más)',
    (mode) => {
      const palette = PALETTE[mode];
      for (const severity of SEVERITIES) {
        expect(getContrastRatio(palette[severity], palette.paper), severity).toBeGreaterThanOrEqual(
          4.5,
        );
      }
      expect(getContrastRatio(palette.text, palette.paper)).toBeGreaterThanOrEqual(7);
      expect(getContrastRatio(palette.textSecondary, palette.paper)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('el tema usa esos colores para error, advertencia, información y éxito', () => {
    const { colorSchemes: schemes } = theme as unknown as {
      colorSchemes: Record<
        'light' | 'dark',
        { palette: Record<'error' | 'warning' | 'info' | 'success', { main: string }> } | undefined
      >;
    };
    const light = schemes.light?.palette;
    expect(light?.error.main).toBe(PALETTE.light.critica);
    expect(light?.warning.main).toBe(PALETTE.light.advertencia);
    expect(light?.info.main).toBe(PALETTE.light.informativa);
    expect(light?.success.main).toBe(PALETTE.light.correcta);
  });
});

const withTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

describe('[RF-188] estado con color, ícono y texto', () => {
  it.each([
    ['critica', 'Crítica'],
    ['advertencia', 'Advertencia'],
    ['informativa', 'Informativa'],
    ['correcta', 'Correcta'],
  ] as const)('el nivel %s muestra su texto y su ícono, y lo dice al lector', (severity, name) => {
    withTheme(<Status severity={severity} label="Stock bajo" />);
    const status = screen.getByRole('status', { name: `${name}: Stock bajo` });
    expect(status).toHaveTextContent('Stock bajo');
    expect(status.querySelector('svg')).not.toBeNull();
  });

  it('un punto de atención dice su severidad y ofrece la acción que lo resuelve', async () => {
    const onClick = vi.fn();
    withTheme(
      <AttentionCard
        severity="critica"
        title="Caja 1 requiere Corte Z"
        action={{ label: 'Hacer el Corte Z', onClick }}
      />,
    );
    expect(screen.getByRole('group', { name: 'Crítica: Caja 1 requiere Corte Z' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Hacer el Corte Z' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

function DetailHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
        }}
      >
        Ver detalle
      </button>
      <DetailPanel
        title="Detalle del producto"
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      >
        Costo sin IVA
      </DetailPanel>
    </>
  );
}

describe('[RF-192] segundo nivel de información', () => {
  it('se abre con un clic o con Enter, se cierra con Esc y devuelve el foco', async () => {
    const user = userEvent.setup();
    withTheme(<DetailHarness />);
    const opener = screen.getByRole('button', { name: 'Ver detalle' });

    opener.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Costo sin IVA')).toBeVisible();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByText('Costo sin IVA')).toBeNull();
    });
    expect(opener).toHaveFocus();

    await user.click(opener);
    expect(await screen.findByRole('heading', { name: 'Detalle del producto' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cerrar el detalle' }));
    await waitFor(() => {
      expect(screen.queryByText('Costo sin IVA')).toBeNull();
    });
  });
});
