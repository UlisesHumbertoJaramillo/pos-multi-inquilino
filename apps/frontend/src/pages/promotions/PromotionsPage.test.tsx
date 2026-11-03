import type { Promotion, PromotionCreateRequest, SessionTokens } from '@pos/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockApi, renderApp } from '../../test/render';

const later = () => new Date(Date.now() + 5 * 60_000).toISOString();

const AC_SESSION: SessionTokens = {
  tokenAcceso: 'a.b.c',
  tokenAccesoVenceEn: later(),
  tokenRenovacion: 'renovacion-del-ac-0123456789',
  sesionVenceEn: later(),
  usuario: {
    id: 'ac',
    email: 'ac@demo.local',
    nombre: 'Ana',
    comercioId: 'demo',
    roles: ['AC'],
    rolActivo: 'AC',
    sucursales: [],
  },
  requiereElegirRol: false,
};

beforeEach(() => {
  sessionStorage.clear();
});

describe('[RF-048] promociones del AC', () => {
  it('el AC crea un 2x1 y aparece como vigente', async () => {
    const promotions: Promotion[] = [];
    let created: PromotionCreateRequest | undefined;
    sessionStorage.setItem('pos.tokenRenovacion', AC_SESSION.tokenRenovacion);
    mockApi({
      'POST /auth/renovar': () => ({ status: 200, body: AC_SESSION }),
      'GET /promociones': () => ({ status: 200, body: promotions }),
      'GET /catalogo/productos': () => ({ status: 200, body: [] }),
      'GET /catalogo/categorias': () => ({
        status: 200,
        body: [{ id: 'bebidas', nombre: 'Bebidas', tasaIva: '21.0000', activa: true }],
      }),
      'GET /catalogo/sucursales': () => ({
        status: 200,
        body: [{ sucursalId: 'centro', nombre: 'Centro', listaId: null }],
      }),
      'POST /promociones': (body) => {
        created = body as PromotionCreateRequest;
        const promotion: Promotion = {
          id: 'p1',
          nombre: created.nombre,
          regla: created.regla,
          alcance: created.alcance,
          objetivo: { id: 'bebidas', nombre: 'Bebidas' },
          vigenteDesde: created.vigenteDesde,
          vigenteHasta: created.vigenteHasta,
          sucursales: created.sucursales,
          activa: true,
          vigente: true,
        };
        promotions.push(promotion);
        return { status: 201, body: promotion };
      },
    });
    renderApp('/admin/promociones');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Nueva promoción' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Nombre/), '2x1 en bebidas');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Promoción «2x1 en bebidas» creada.')).toBeInTheDocument();
    expect(created).toMatchObject({
      regla: { tipo: 'nxm', lleva: 2, paga: 1 },
      alcance: 'categoria',
      objetivoId: 'bebidas',
      sucursales: null,
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    const table = screen.getByRole('table', { name: 'Promociones' });
    const row = (await within(table).findByText('2x1 en bebidas')).closest('tr');
    if (!row) throw new Error('Falta la fila de la promoción.');
    expect(within(row).getByText('2x1')).toBeInTheDocument();
    expect(within(row).getByText('Categoría Bebidas')).toBeInTheDocument();
    expect(within(row).getByText('Vigente')).toBeInTheDocument();
  });
});
