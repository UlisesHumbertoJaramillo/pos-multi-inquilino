import type { CashShift, ProductSection, Role, SessionTokens } from '@pos/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '../test/render';

const later = () => new Date(Date.now() + 5 * 60_000).toISOString();

const sessionOf = (role: Role): SessionTokens => ({
  tokenAcceso: 'a.b.c',
  tokenAccesoVenceEn: later(),
  tokenRenovacion: `renovacion-${role}-0123456789`,
  sesionVenceEn: later(),
  usuario: {
    id: role,
    email: `${role}@demo.local`,
    nombre: `Usuario ${role}`,
    comercioId: 'demo',
    moduloFacturacion: false,
    nombreComercio: 'Demo',
    detalleSucursales: role === 'AC' ? [] : [{ id: 'centro', nombre: 'Centro' }],
    roles: [role],
    rolActivo: role,
    sucursales: role === 'AC' ? [] : ['centro'],
  },
  requiereElegirRol: false,
});

function signedInAs(role: Role, handlers: Parameters<typeof mockApi>[0]) {
  sessionStorage.setItem('pos.tokenRenovacion', sessionOf(role).tokenRenovacion);
  return mockApi({
    'POST /auth/renovar': () => ({ status: 200, body: sessionOf(role) }),
    'GET /alertas': () => ({ status: 200, body: [] }),
    'GET /alertas/resumen': () => ({ status: 200, body: { cantidad: 0, severidadMaxima: null } }),
    ...handlers,
  });
}

const SHORTCUTS = (cobrar: string | null, porDefecto = true) => ({
  porDefecto,
  atajos: [
    { accion: 'cobrar', nombre: 'Cobrar la venta', tecla: cobrar, teclaPorDefecto: 'NumpadAdd' },
    { accion: 'corte_x', nombre: 'Corte X', tecla: 'F8', teclaPorDefecto: 'F8' },
  ],
  teclasPermitidas: ['NumpadAdd', 'F2', 'F8'],
});

describe('[RF-185] el AC configura los atajos del POS', () => {
  it('cambia una tecla, la guarda y ve el rechazo del backend', async () => {
    let saved: unknown;
    let reject = false;
    signedInAs('AC', {
      'GET /organizacion/atajos': () => ({ status: 200, body: SHORTCUTS('NumpadAdd') }),
      'PUT /organizacion/atajos': (body) => {
        saved = body;
        if (reject) {
          return {
            status: 409,
            body: { codigo: 'ATAJO_REPETIDO', mensaje: 'F8 ya es el atajo de «Corte X».' },
          };
        }
        return { status: 200, body: SHORTCUTS('F2', false) };
      },
    });
    renderApp('/admin/atajos');
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Tecla de Cobrar la venta'));
    await user.click(await screen.findByRole('option', { name: 'F2' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/Atajos guardados/)).toBeVisible();
    expect(saved).toEqual({ atajos: { cobrar: 'F2', corte_x: 'F8' } });

    reject = true;
    await user.click(await screen.findByLabelText('Tecla de Cobrar la venta'));
    await user.click(await screen.findByRole('option', { name: 'F8' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('F8 ya es el atajo de «Corte X».')).toBeVisible();
  });
});

const SHIFT = {
  id: 'turno1',
  cajaId: 'caja1',
  caja: 'Caja 1',
  sucursalId: 'centro',
  vendedorId: 'VO',
  vendedor: 'Usuario VO',
  jornadaId: 'j1',
  fechaJornada: '2026-11-10',
  saldoInicial: '1000.00',
  abiertoEn: '2026-11-10T12:00:00Z',
  estado: 'abierto',
  forzado: false,
} as unknown as CashShift;

const product = (id: string, nombre: string, disponible = '5.000') => ({
  id,
  nombre,
  tipo: 'simple' as const,
  codigoBarras: null,
  precio: '100.00',
  disponible,
});

const SECTION: ProductSection = {
  masVendidos: [product('agua', 'Agua'), product('gaseosa', 'Gaseosa')],
  categorias: [
    {
      id: 'bebidas',
      nombre: 'Bebidas',
      productos: [product('agua', 'Agua'), product('gaseosa', 'Gaseosa')],
    },
    { id: 'almacen', nombre: 'Almacén', productos: [product('yerba', 'Yerba', '0.000')] },
  ],
};

describe('[RF-179] [RF-180] sección de productos del POS', () => {
  it('se elige con el mouse y se recorre con las flechas', async () => {
    let started: unknown;
    signedInAs('VO', {
      'GET /caja/turno': () => ({
        status: 200,
        body: { turno: SHIFT, movimientos: [] },
      }),
      'GET /ventas': () => ({ status: 200, body: { ventas: [], traspasosRecibidos: [] } }),
      'GET /cuenta-corriente/cobros': () => ({ status: 200, body: [] }),
      'GET /ventas/catalogo': () => ({ status: 200, body: SECTION }),
      'POST /ventas': (body) => {
        started = body;
        return { status: 409, body: { codigo: 'X', mensaje: 'Sin stock.' } };
      },
    });
    renderApp('/pos');
    const user = userEvent.setup();

    // En pantallas angostas la sección se abre con un botón; en anchas está al costado.
    const opener = await screen.findByRole('button', { name: 'Elegir de la lista de productos' });
    await user.click(opener);
    const section = await screen.findByRole('region', { name: 'Productos' });
    expect(within(section).getByRole('tab', { name: 'Más vendidos' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    const agua = within(section).getByRole('button', { name: /^Agua,/ });
    agua.focus();
    fireEvent.keyDown(agua, { key: 'ArrowRight' });
    expect(within(section).getByRole('button', { name: /^Gaseosa,/ })).toHaveFocus();

    await user.click(within(section).getByRole('button', { name: /^Gaseosa,/ }));
    await vi.waitFor(() => {
      expect(started).toEqual({ productoId: 'gaseosa', cantidad: '1' });
    });

    // Un producto sin stock no se puede elegir.
    await user.click(within(section).getByRole('tab', { name: 'Almacén' }));
    expect(within(section).getByRole('button', { name: /^Yerba,/ })).toBeDisabled();
  });
});

describe('[RF-194] atajos de la administración', () => {
  it('F2 abre «Ir a…» y Enter lleva a la sección elegida', async () => {
    signedInAs('AC', {
      'GET /organizacion/atajos': () => ({ status: 200, body: SHORTCUTS('NumpadAdd') }),
    });
    const router = renderApp('/admin');
    const user = userEvent.setup();
    const go = await screen.findByRole('button', { name: 'Ir a una sección' });
    expect(go).toHaveTextContent('F2');

    fireEvent.keyDown(document.body, { code: 'F2', key: 'F2' });
    const dialog = await screen.findByRole('dialog', { name: 'Ir a una sección' });
    await user.type(within(dialog).getByLabelText('Sección'), 'atajos');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin/atajos');
    });
  });
});
