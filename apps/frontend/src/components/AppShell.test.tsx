import type { OwnShift, Role, SessionTokens } from '@pos/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, renderApp } from '../test/render';

const later = () => new Date(Date.now() + 5 * 60_000).toISOString();

const BRANCHES: Record<Role, { id: string; nombre: string }[]> = {
  SA: [],
  AC: [],
  AS: [
    { id: 'centro', nombre: 'Centro' },
    { id: 'norte', nombre: 'Norte' },
  ],
  VO: [{ id: 'centro', nombre: 'Centro' }],
};

const sessionOf = (role: Role): SessionTokens => ({
  tokenAcceso: 'a.b.c',
  tokenAccesoVenceEn: later(),
  tokenRenovacion: `renovacion-${role}-0123456789`,
  sesionVenceEn: later(),
  usuario: {
    id: role,
    email: `${role}@demo.local`,
    nombre: `Usuario ${role}`,
    comercioId: role === 'SA' ? null : 'demo',
    moduloFacturacion: false,
    nombreComercio: role === 'SA' ? null : 'Almacén Don Pedro',
    detalleSucursales: BRANCHES[role],
    roles: [role],
    rolActivo: role,
    sucursales: BRANCHES[role].map((b) => b.id),
  },
  requiereElegirRol: false,
});

const SHIFT = {
  turno: {
    id: 't1',
    cajaId: 'caja1',
    caja: 'Caja 1',
    sucursalId: 'centro',
    jornadaId: 'j1',
    fechaJornada: '2026-11-10',
    saldoInicial: '1000.00',
    abiertoEn: '2026-11-10T12:00:00Z',
  },
  movimientos: [],
} as unknown as OwnShift;

function signedInAs(role: Role) {
  sessionStorage.setItem('pos.tokenRenovacion', sessionOf(role).tokenRenovacion);
  mockApi({
    'POST /auth/renovar': () => ({ status: 200, body: sessionOf(role) }),
    'GET /caja/turno': () => ({ status: 200, body: SHIFT }),
    'GET /alertas': () => ({ status: 200, body: [] }),
    'GET /alertas/resumen': () => ({ status: 200, body: { cantidad: 0, severidadMaxima: null } }),
  });
}

const place = () => screen.findByLabelText('Dónde estás operando');

describe('[RF-178] [RF-193] el mismo encabezado para los cuatro roles', () => {
  it.each([
    ['SA', '/admin', 'Sistema POS', 'Plataforma'],
    ['AC', '/admin', 'Almacén Don Pedro', 'Todas las sucursales'],
    ['AS', '/admin', 'Almacén Don Pedro', '2 sucursales'],
  ] as const)(
    'el %s ve el comercio, dónde opera y quién es',
    async (role, path, tenant, branch) => {
      signedInAs(role);
      renderApp(path);

      expect(await within(await place()).findByText(branch)).toBeInTheDocument();
      const header = screen.getByRole('banner');
      expect(within(header).getByText(tenant)).toBeInTheDocument();
      expect(
        within(header).getByRole('button', { name: new RegExp(`^Usuario ${role},`) }),
      ).toBeVisible();
      // Las alertas se ven en todas las pantallas de los roles del comercio.
      expect(within(header).queryAllByRole('button', { name: /^Alertas/ })).toHaveLength(
        role === 'SA' ? 0 : 1,
      );
    },
  );

  it('en el POS, el VO ve su sucursal, su caja, quién es y sus alertas sin hacer nada', async () => {
    signedInAs('VO');
    renderApp('/pos');

    const where = await place();
    expect(within(where).getByText('Centro')).toBeInTheDocument();
    expect(await within(where).findByText('Caja 1')).toBeInTheDocument();
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('button', { name: 'Usuario VO, Vendedor' })).toBeVisible();
    expect(await within(header).findByRole('button', { name: 'Alertas (0)' })).toBeVisible();
  });
});
