import type {
  Cart,
  CashShift,
  OwnShift,
  SaleReceipt,
  SaleSearchResult,
  SalesOverview,
  SessionTokens,
} from '@pos/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '../../test/render';

const later = () => new Date(Date.now() + 5 * 60_000).toISOString();

const SESSION: SessionTokens = {
  tokenAcceso: 'a.b.c',
  tokenAccesoVenceEn: later(),
  tokenRenovacion: 'renovacion-del-vo-0123456789',
  sesionVenceEn: later(),
  usuario: {
    id: 'vo',
    email: 'vo@demo.local',
    nombre: 'Valeria',
    comercioId: 'demo',
    roles: ['VO'],
    rolActivo: 'VO',
    sucursales: ['centro'],
  },
  requiereElegirRol: false,
};

const SHIFT: CashShift = {
  id: 'turno1',
  cajaId: 'caja1',
  caja: 'Caja 1',
  sucursalId: 'centro',
  jornadaId: 'j1',
  fechaJornada: '2026-11-04',
  vendedorId: 'vo',
  vendedor: 'Valeria',
  saldoInicial: '1000.00',
  diferenciaInicial: null,
  abiertoEn: '2026-11-04T12:00:00Z',
  estado: 'abierto',
  forzado: false,
};

const emptyCart = (): Cart => ({
  id: 'venta1',
  estado: 'en_curso',
  numeroTicket: null,
  sucursalId: 'centro',
  cajaId: 'caja1',
  turnoId: 'turno1',
  vendedorId: 'vo',
  items: [],
  subtotal: '0.00',
  descuentoPromociones: '0.00',
  descuentoManual: '0.00',
  descuento: null,
  total: '0.00',
  iva: [],
  traspaso: null,
  ultimaActividad: '2026-11-04T12:00:00Z',
});

const AGUA: SaleSearchResult = {
  id: 'agua',
  nombre: 'Agua mineral',
  tipo: 'simple',
  codigoBarras: '7790001',
  precio: '300.00',
  disponible: '10.000',
};

beforeEach(() => {
  sessionStorage.clear();
});

describe('[RF-054] [RF-060] [RF-050] carrito del POS', () => {
  it('el VO arma un carrito por búsqueda, ve la promoción resaltada y cobra en efectivo', async () => {
    const own: OwnShift = { turno: SHIFT, movimientos: [] };
    const overview: SalesOverview = { ventas: [], traspasosRecibidos: [] };
    let paid: Record<string, unknown> | undefined;
    const withWater: Cart = {
      ...emptyCart(),
      items: [
        {
          id: 'item1',
          productoId: 'agua',
          tipo: 'simple',
          nombre: 'Agua mineral',
          cantidad: '2.000',
          precioUnitario: '300.00',
          promocion: { id: 'p1', nombre: '2x1 en agua' },
          descuentoPromocion: '300.00',
          descuentoManual: '0.00',
          importeFinal: '300.00',
        },
      ],
      subtotal: '300.00',
      descuentoPromociones: '300.00',
      total: '300.00',
    };
    sessionStorage.setItem('pos.tokenRenovacion', SESSION.tokenRenovacion);
    mockApi({
      'POST /auth/renovar': () => ({ status: 200, body: SESSION }),
      'GET /caja/turno': () => ({ status: 200, body: own }),
      'GET /ventas': () => ({ status: 200, body: overview }),
      'GET /ventas/productos': () => ({ status: 200, body: [AGUA] }),
      'POST /ventas': () => {
        overview.ventas = [emptyCart()];
        return { status: 201, body: emptyCart() };
      },
      'POST /ventas/venta1/items': () => {
        overview.ventas = [withWater];
        return { status: 200, body: withWater };
      },
      'POST /ventas/venta1/cobro': (body) => {
        paid = body as Record<string, unknown>;
        overview.ventas = [];
        const receipt: SaleReceipt = {
          venta: { ...withWater, estado: 'confirmada', numeroTicket: 7 },
          numeroTicket: 7,
          cobrado: '300.00',
          ajuste: '0.00',
          entregado: '500.00',
          vuelto: '200.00',
          seFactura: false,
          estadoFiscal: 'no_se_factura',
        };
        return { status: 200, body: receipt };
      },
    });
    renderApp('/pos');
    const user = userEvent.setup();

    // La lista aparece mientras se escribe, sin tocar Enter.
    await user.type(await screen.findByLabelText('Buscar por nombre o código'), 'agu');
    const results = await screen.findByRole('listbox');
    await user.click(await within(results).findByText('Agua mineral'));

    const cart = await screen.findByRole('table', { name: 'Carrito' });
    expect(await within(cart).findByText('2x1 en agua −$ 300,00')).toBeInTheDocument();
    expect(screen.getByText('Total: $ 300,00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cobrar en efectivo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cobrar en efectivo' });
    await user.type(within(dialog).getByLabelText('Entregado'), '500');
    await user.click(within(dialog).getByRole('button', { name: 'Cobrar' }));

    const receipt = await screen.findByRole('dialog', { name: 'Venta cobrada · Ticket 7' });
    expect(within(receipt).getByText('Vuelto: $ 200,00')).toBeInTheDocument();
    expect(paid).toEqual({ entregado: '500' });
  });

  it('un código de barras escaneado con Enter agrega el producto sin elegirlo de la lista', async () => {
    const own: OwnShift = { turno: SHIFT, movimientos: [] };
    const sale = emptyCart();
    let added: unknown;
    sessionStorage.setItem('pos.tokenRenovacion', SESSION.tokenRenovacion);
    mockApi({
      'POST /auth/renovar': () => ({ status: 200, body: SESSION }),
      'GET /caja/turno': () => ({ status: 200, body: own }),
      'GET /ventas': () => ({
        status: 200,
        body: { ventas: [sale], traspasosRecibidos: [] } satisfies SalesOverview,
      }),
      'GET /ventas/productos': () => ({ status: 200, body: [AGUA] }),
      'POST /ventas/venta1/items': (body) => {
        added = body;
        return { status: 200, body: sale };
      },
    });
    renderApp('/pos');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Buscar por nombre o código'), '7790001{Enter}');
    await vi.waitFor(() => {
      expect(added).toEqual({ productoId: 'agua', cantidad: '1' });
    });
  });
});
