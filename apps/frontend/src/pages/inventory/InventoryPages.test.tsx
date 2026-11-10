import type {
  SessionTokens,
  StockRow,
  Transfer,
  TransferBranch,
  TransferReceptionRequest,
  WasteRequest,
} from '@pos/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockApi, renderApp, type ApiHandler } from '../../test/render';

const later = () => new Date(Date.now() + 5 * 60_000).toISOString();

const AS_SESSION: SessionTokens = {
  tokenAcceso: 'a.b.c',
  tokenAccesoVenceEn: later(),
  tokenRenovacion: 'renovacion-del-as-0123456789',
  sesionVenceEn: later(),
  usuario: {
    id: 'as',
    email: 'as@demo.local',
    nombre: 'Sergio',
    comercioId: 'demo',
    moduloFacturacion: true,
    roles: ['AS'],
    rolActivo: 'AS',
    sucursales: ['centro', 'norte'],
  },
  requiereElegirRol: false,
};

const BRANCHES: TransferBranch[] = [
  { id: 'centro', nombre: 'Centro', propia: true },
  { id: 'norte', nombre: 'Norte', propia: true },
];

function row(overrides: Partial<StockRow>): StockRow {
  return {
    productoId: 'leche',
    nombre: 'Leche',
    codigoBarras: null,
    activo: true,
    disponible: '10.000',
    reservado: '0.000',
    enRevision: '0.000',
    enTransito: '0.000',
    umbralMinimo: '5.000',
    alertaActiva: false,
    ...overrides,
  };
}

function mockAs(handlers: Record<string, ApiHandler>) {
  sessionStorage.setItem('pos.tokenRenovacion', AS_SESSION.tokenRenovacion);
  return mockApi({
    'POST /auth/renovar': () => ({ status: 200, body: AS_SESSION }),
    'GET /inventario/sucursales': () => ({ status: 200, body: BRANCHES }),
    ...handlers,
  });
}

beforeEach(() => {
  sessionStorage.clear();
});

describe('[RF-042] inventario del AS', () => {
  it('el AS registra una merma y ve el stock actualizado', async () => {
    let stock = [row({})];
    let waste: WasteRequest | undefined;
    mockAs({
      'GET /inventario/sucursales/centro/stock': () => ({ status: 200, body: stock }),
      'GET /inventario/sucursales/centro/alertas': () => ({ status: 200, body: [] }),
      'GET /inventario/sucursales/centro/combos': () => ({
        status: 200,
        body: [{ comboId: 'c', nombre: 'Combo merienda', unidades: 3, vendible: true }],
      }),
      'GET /inventario/sucursales/centro/movimientos': () => ({ status: 200, body: [] }),
      'POST /inventario/sucursales/centro/mermas': (body) => {
        waste = body as WasteRequest;
        stock = [row({ disponible: '7.000' })];
        return { status: 200, body: { ...stock[0] } };
      },
    });
    renderApp('/admin/inventario');
    const user = userEvent.setup();

    const table = await screen.findByRole('table', { name: 'Stock de la sucursal' });
    expect(await within(table).findByText('10')).toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Disponibilidad de combos' })).getByText('3'),
    ).toBeInTheDocument();

    await user.click(within(table).getByRole('button', { name: 'Merma de Leche' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Cantidad/), '3');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Merma de Leche registrada.')).toBeInTheDocument();
    expect(waste).toStrictEqual({
      productoId: 'leche',
      cantidad: '3',
      motivo: 'rotura',
      observacion: null,
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await within(table).findByText('7')).toBeInTheDocument();
  });
});

describe('[RF-044] [RF-045] transferencias del AS', () => {
  it('el AS recibe una transferencia con un faltante', async () => {
    const transfer: Transfer = {
      id: 't1',
      origen: { id: 'centro', nombre: 'Centro' },
      destino: { id: 'norte', nombre: 'Norte' },
      estado: 'enviada',
      emitidaEn: new Date().toISOString(),
      cerradaEn: null,
      items: [
        {
          productoId: 'leche',
          nombre: 'Leche',
          enviada: '4.000',
          recibida: null,
          rechazada: null,
          faltante: null,
        },
      ],
    };
    let reception: TransferReceptionRequest | undefined;
    mockAs({
      'GET /inventario/transferencias': () => ({ status: 200, body: [transfer] }),
      'POST /inventario/transferencias/t1/recepcion': (body) => {
        reception = body as TransferReceptionRequest;
        transfer.estado = 'parcial';
        transfer.items = transfer.items.map((item) => ({
          ...item,
          recibida: '3.000',
          rechazada: '0.000',
          faltante: '1.000',
        }));
        return { status: 200, body: transfer };
      },
    });
    renderApp('/admin/transferencias');
    const user = userEvent.setup();

    const table = await screen.findByRole('table', { name: 'Transferencias' });
    await user.click(await within(table).findByRole('button', { name: 'Recibir' }));
    const dialog = await screen.findByRole('dialog');
    const received = within(dialog).getByLabelText('Recibidas de Leche');
    await user.clear(received);
    await user.type(received, '3');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar recepción' }));

    expect(await screen.findByText('Transferencia recibida.')).toBeInTheDocument();
    expect(reception).toStrictEqual({
      items: [{ productoId: 'leche', recibida: '3', rechazada: '0' }],
    });
    expect(await within(table).findByText('Recibida con diferencias')).toBeInTheDocument();
    expect(within(table).getByText('4 × Leche (faltaron 1)')).toBeInTheDocument();
  });
});
