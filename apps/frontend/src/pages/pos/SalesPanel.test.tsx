import type {
  Cart,
  CashShift,
  OwnShift,
  SalePayment,
  SalePaymentAttempt,
  SalePaymentMethod,
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
  cliente: null,
  pagos: [],
  porCobrar: '0.00',
});

const EFECTIVO: SalePaymentMethod = {
  id: 'efectivo',
  nombre: 'Efectivo',
  tipo: 'efectivo',
  recargoPct: '0.0000',
};
const TARJETA: SalePaymentMethod = {
  id: 'tarjeta',
  nombre: 'Tarjeta',
  tipo: 'electronico',
  recargoPct: '10.0000',
};
const CUENTA: SalePaymentMethod = {
  id: 'cuenta',
  nombre: 'Cuenta corriente',
  tipo: 'cuenta_corriente',
  recargoPct: '0.0000',
};

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

const WATER_ITEM: Cart['items'][number] = {
  id: 'item1',
  productoId: 'agua',
  tipo: 'simple',
  nombre: 'Agua mineral',
  cantidad: '1.000',
  precioUnitario: '1000.00',
  promocion: null,
  descuentoPromocion: '0.00',
  descuentoManual: '0.00',
  importeFinal: '1000.00',
};

const saleOf = (extra: Partial<Cart>): Cart => ({
  ...emptyCart(),
  items: [WATER_ITEM],
  subtotal: '1000.00',
  total: '1000.00',
  porCobrar: '1000.00',
  ...extra,
});

const CARD_PAYMENT: SalePayment = {
  id: 'pago1',
  metodoPagoId: 'tarjeta',
  metodo: 'Tarjeta',
  tipo: 'electronico',
  fraccion: '400.00',
  recargo: '40.00',
  entregado: '440.00',
  vuelto: '0.00',
  estado: 'aprobado',
  resolucionManual: false,
};

function posApi(sale: Cart, extra: Parameters<typeof mockApi>[0]) {
  const own: OwnShift = { turno: SHIFT, movimientos: [] };
  sessionStorage.setItem('pos.tokenRenovacion', SESSION.tokenRenovacion);
  mockApi({
    'POST /auth/renovar': () => ({ status: 200, body: SESSION }),
    'GET /caja/turno': () => ({ status: 200, body: own }),
    'GET /ventas': () => ({
      status: 200,
      body: { ventas: [sale], traspasosRecibidos: [] } satisfies SalesOverview,
    }),
    'GET /cuenta-corriente/cobros': () => ({ status: 200, body: [] }),
    'GET /ventas/metodos-pago': () => ({ status: 200, body: [EFECTIVO, TARJETA, CUENTA] }),
    ...extra,
  });
}

describe('[RF-068] [RF-073] [RF-074] [RF-126] cobro mixto, crédito y pago por verificar', () => {
  it('cobra una fracción con la tarjeta y el resto en efectivo, con los importes del backend', async () => {
    let confirmed: unknown;
    const attempt: SalePaymentAttempt = {
      venta: saleOf({ pagos: [CARD_PAYMENT], porCobrar: '600.00' }),
      pago: CARD_PAYMENT,
    };
    posApi(saleOf({}), {
      'POST /ventas/venta1/pagos': () => ({ status: 201, body: attempt }),
      'POST /ventas/venta1/cobro': (body) => {
        confirmed = body;
        return { status: 400, body: { codigo: 'X', mensaje: 'Fin de la prueba.' } };
      },
    });
    renderApp('/pos');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Cobrar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cobrar la venta' });
    await user.type(within(dialog).getByLabelText('Tarjeta (10 %)'), '400');
    await user.click(within(dialog).getByRole('button', { name: 'Cobrar' }));
    expect(await within(dialog).findByText('Falta cobrar: $ 600,00')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Confirmar venta' }));
    await vi.waitFor(() => {
      expect(confirmed).toEqual({
        pagos: [{ metodoPagoId: 'efectivo', fraccion: '600.00', entregado: null }],
      });
    });
  });

  it('un exceso de crédito pide el PIN y repite con la autorización', async () => {
    const calls: unknown[] = [];
    const cliente = {
      id: 'c1',
      razonSocial: 'Kiosco',
      documento: null,
      cuentaCorriente: true,
      saldo: '0.00',
      disponible: '800.00',
    };
    posApi(saleOf({ cliente }), {
      'GET /autorizaciones/autorizantes': () => ({
        status: 200,
        body: [{ id: 'as', nombre: 'Ana', rol: 'AS' }],
      }),
      'POST /autorizaciones': () => ({ status: 201, body: { id: 'autorizacion1' } }),
      'POST /ventas/venta1/cobro': (body) => {
        calls.push(body);
        return calls.length === 1
          ? {
              status: 409,
              body: { codigo: 'CREDITO_EXCEDIDO', mensaje: 'Supera el crédito: $ 800,00.' },
            }
          : { status: 400, body: { codigo: 'X', mensaje: 'Fin de la prueba.' } };
      },
    });
    renderApp('/pos');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Cobrar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cobrar la venta' });
    await user.clear(within(dialog).getByLabelText('Efectivo'));
    await user.type(within(dialog).getByLabelText('Cuenta corriente'), '1000');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar venta' }));

    const pin = await screen.findByRole('dialog', { name: 'Autorización con PIN' });
    expect(within(pin).getByText('Supera el crédito: $ 800,00.')).toBeInTheDocument();
    await user.type(within(pin).getByLabelText('PIN'), '2222');
    await user.click(within(pin).getByRole('button', { name: 'Autorizar' }));
    await vi.waitFor(() => {
      expect(calls[1]).toMatchObject({ autorizacionId: 'autorizacion1' });
    });
  });

  it('una venta por verificar no se puede cobrar y ofrece la resolución manual', async () => {
    posApi(
      saleOf({
        estado: 'pago_por_verificar',
        pagos: [{ ...CARD_PAYMENT, estado: 'por_verificar', resolucionManual: true }],
      }),
      {},
    );
    renderApp('/pos');

    expect(await screen.findByText(/Hay un pago por verificar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cobrar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Se cobró' })).toBeInTheDocument();
  });
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
      porCobrar: '300.00',
    };
    sessionStorage.setItem('pos.tokenRenovacion', SESSION.tokenRenovacion);
    mockApi({
      'POST /auth/renovar': () => ({ status: 200, body: SESSION }),
      'GET /caja/turno': () => ({ status: 200, body: own }),
      'GET /ventas': () => ({ status: 200, body: overview }),
      'GET /ventas/productos': () => ({ status: 200, body: [AGUA] }),
      'GET /cuenta-corriente/cobros': () => ({ status: 200, body: [] }),
      'GET /ventas/metodos-pago': () => ({ status: 200, body: [EFECTIVO] }),
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
          estadoCobro: 'pagada',
          pagos: [],
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

    await user.click(screen.getByRole('button', { name: 'Cobrar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cobrar la venta' });
    await user.type(within(dialog).getByLabelText('Entregado'), '500');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar venta' }));

    const receipt = await screen.findByRole('dialog', { name: 'Venta cobrada · Ticket 7' });
    expect(within(receipt).getByText('Vuelto: $ 200,00')).toBeInTheDocument();
    expect(paid).toEqual({
      pagos: [{ metodoPagoId: 'efectivo', fraccion: '300.00', entregado: '500' }],
    });
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
      'GET /cuenta-corriente/cobros': () => ({ status: 200, body: [] }),
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
