import type { SessionTokens, Tenant, TenantCreateRequest } from '@pos/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderApp } from '../../test/render';

const later = () => new Date(Date.now() + 5 * 60_000).toISOString();

const SA_SESSION: SessionTokens = {
  tokenAcceso: 'a.b.c',
  tokenAccesoVenceEn: later(),
  tokenRenovacion: 'renovacion-del-sa-0123456789',
  sesionVenceEn: later(),
  usuario: {
    id: 'sa',
    email: 'sa@demo.local',
    nombre: 'Super',
    comercioId: null,
    moduloFacturacion: true,
    roles: ['SA'],
    rolActivo: 'SA',
    sucursales: [],
  },
  requiereElegirRol: false,
};

describe('[RF-013] [RF-163] comercios del SA', () => {
  it('el SA crea un comercio y le activa el módulo de facturación', async () => {
    // Sesión guardada: la pantalla la recupera renovándola.
    sessionStorage.setItem('pos.tokenRenovacion', SA_SESSION.tokenRenovacion);
    const tenants: Tenant[] = [];
    const api = mockApi({
      'POST /auth/renovar': () => ({ status: 200, body: SA_SESSION }),
      'GET /plataforma/comercios': () => ({ status: 200, body: tenants }),
      'POST /plataforma/comercios': (body) => {
        const input = body as TenantCreateRequest;
        const tenant: Tenant = {
          id: 't-nuevo',
          nombre: input.nombre,
          cuit: null,
          moneda: input.moneda,
          zonaHoraria: input.zonaHoraria,
          estado: 'activo',
          tieneOperaciones: false,
          moduloFacturacion: false,
          creadoEn: new Date().toISOString(),
        };
        tenants.push(tenant);
        return { status: 201, body: tenant };
      },
      'PUT /plataforma/comercios/t-nuevo/modulo-facturacion': (body) => {
        const [tenant] = tenants;
        if (tenant) tenant.moduloFacturacion = (body as { activo: boolean }).activo;
        return { status: 200, body: tenant };
      },
    });
    renderApp('/admin/comercios');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Nuevo comercio' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Nombre/), 'Almacén Don Pepe');
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));

    expect(await screen.findByText('Comercio «Almacén Don Pepe» creado.')).toBeInTheDocument();
    // Mientras el diálogo se cierra, el resto de la página queda oculto para la accesibilidad.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    const row = (await screen.findByText('Almacén Don Pepe')).closest('tr');
    if (!row) throw new Error('No se encontró la fila del comercio.');

    await user.click(within(row).getByRole('switch', { name: 'Facturación de Almacén Don Pepe' }));

    expect(
      await screen.findByText('Facturación activada para Almacén Don Pepe.'),
    ).toBeInTheDocument();
    expect(within(row).getByText('Activo')).toBeInTheDocument();
    const toggle = api.mock.calls.find(
      ([input]) => typeof input === 'string' && input.endsWith('/modulo-facturacion'),
    );
    expect(toggle?.[1]?.body).toBe(JSON.stringify({ activo: true }));
    // Escribir en un diálogo de Material UI sobre jsdom es lento.
  }, 20_000);

  it('el menú del SA muestra sus secciones de plataforma', async () => {
    sessionStorage.setItem('pos.tokenRenovacion', SA_SESSION.tokenRenovacion);
    mockApi({
      'POST /auth/renovar': () => ({ status: 200, body: SA_SESSION }),
      'GET /plataforma/comercios': () => ({ status: 200, body: [] }),
    });
    renderApp('/admin/comercios');

    const nav = await screen.findByRole('navigation', { name: 'Menú principal' });
    for (const label of [
      'Comercios',
      'Cuentas SA',
      'Soporte',
      'Auditoría técnica',
      'Panel técnico',
    ]) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
  });
});
