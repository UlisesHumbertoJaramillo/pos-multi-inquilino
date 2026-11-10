import type {
  PaymentMethod,
  Register,
  RegisterCreateRequest,
  SessionTokens,
  Structure,
  TenantUser,
  TenantUserCreateRequest,
} from '@pos/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockApi, renderApp, type ApiHandler } from '../../test/render';

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
    moduloFacturacion: true,
    nombreComercio: 'Demo',
    detalleSucursales: [],
    roles: ['AC'],
    rolActivo: 'AC',
    sucursales: [],
  },
  requiereElegirRol: false,
};

const CENTRO = 'de000000-0000-4000-8000-0000000000c1';
const NORTE = 'de000000-0000-4000-8000-0000000000c2';

function structure(): Structure {
  return {
    comercio: { id: 'demo', nombre: 'Demo' },
    sucursales: [
      { id: CENTRO, nombre: 'Centro', direccion: 'San Martín 100', activa: true, cajas: [] },
      { id: NORTE, nombre: 'Norte', direccion: null, activa: true, cajas: [] },
    ],
  };
}

function mockAc(handlers: Record<string, ApiHandler>) {
  sessionStorage.setItem('pos.tokenRenovacion', AC_SESSION.tokenRenovacion);
  return mockApi({ 'POST /auth/renovar': () => ({ status: 200, body: AC_SESSION }), ...handlers });
}

// Mientras un diálogo se cierra, el resto de la página queda oculto para la accesibilidad.
async function dialogClosed() {
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
}

beforeEach(() => {
  sessionStorage.clear();
});

describe('[RF-027] [RF-024] estructura del comercio', () => {
  it('el AC ve el árbol y crea una caja desde la pantalla', async () => {
    const current = structure();
    let sent: RegisterCreateRequest | undefined;
    mockAc({
      'GET /organizacion/estructura': () => ({ status: 200, body: current }),
      [`POST /organizacion/sucursales/${CENTRO}/cajas`]: (body) => {
        const input = body as RegisterCreateRequest;
        sent = input;
        const register: Register = {
          id: 'caja-1',
          sucursalId: CENTRO,
          nombre: input.nombre,
          puntoVentaFiscal: input.puntoVentaFiscal ?? null,
          activa: true,
        };
        current.sucursales[0]?.cajas.push(register);
        return { status: 201, body: register };
      },
    });
    renderApp('/admin/estructura');
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Estructura de Demo' })).toBeInTheDocument();
    const centro = screen.getByRole('listitem', { name: 'Sucursal Centro' });
    expect(within(centro).getByText('Sin cajas.')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Sucursal Norte' })).toBeInTheDocument();

    await user.click(within(centro).getByRole('button', { name: 'Nueva caja' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Nombre/), 'Caja 1');
    await user.type(within(dialog).getByLabelText(/Punto de venta fiscal/), '3');
    await user.click(within(dialog).getByRole('button', { name: 'Crear caja' }));

    expect(await screen.findByText('Caja «Caja 1» creada en Centro.')).toBeInTheDocument();
    await dialogClosed();
    expect(await within(centro).findByText('Punto de venta 3')).toBeInTheDocument();
    expect(sent).toStrictEqual({
      nombre: 'Caja 1',
      puntoVentaFiscal: 3,
    });
  });

  it('muestra el motivo cuando el backend rechaza la baja', async () => {
    mockAc({
      'GET /organizacion/estructura': () => ({ status: 200, body: structure() }),
      [`POST /organizacion/sucursales/${NORTE}/baja`]: () => ({
        status: 409,
        body: {
          codigo: 'BAJA_CON_DEPENDENCIAS',
          mensaje: 'No se puede dar de baja la sucursal: tiene 1 turno(s) abierto(s).',
        },
      }),
    });
    window.confirm = () => true;
    renderApp('/admin/estructura');
    const user = userEvent.setup();

    const norte = await screen.findByRole('listitem', { name: 'Sucursal Norte' });
    await user.click(within(norte).getByRole('button', { name: 'Dar de baja' }));

    expect(
      await screen.findByText('No se puede dar de baja la sucursal: tiene 1 turno(s) abierto(s).'),
    ).toBeInTheDocument();
  });
});

describe('[RF-026] usuarios del comercio', () => {
  it('el AC crea un VO para una sucursal', async () => {
    const users: TenantUser[] = [
      {
        id: 'ac',
        email: 'ac@demo.local',
        nombre: 'Ana',
        activo: true,
        correoValidado: true,
        roles: [{ rol: 'AC', sucursalId: null }],
      },
    ];
    let sent: TenantUserCreateRequest | undefined;
    mockAc({
      'GET /organizacion/estructura': () => ({ status: 200, body: structure() }),
      'GET /organizacion/usuarios': () => ({ status: 200, body: users }),
      'POST /organizacion/usuarios': (body) => {
        sent = body as TenantUserCreateRequest;
        users.push({
          id: 'nuevo',
          email: sent.email,
          nombre: sent.nombre,
          activo: true,
          correoValidado: false,
          roles: sent.roles,
        });
        return { status: 201, body: { usuarioId: 'nuevo', email: sent.email } };
      },
    });
    renderApp('/admin/usuarios');
    const user = userEvent.setup();

    await screen.findByText('Ana · ac@demo.local');
    await user.click(screen.getByRole('button', { name: 'Nuevo usuario' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Nombre/), 'Nuevo Vendedor');
    await user.type(within(dialog).getByLabelText(/^Correo/), 'nuevo@demo.local');
    await user.click(within(dialog).getByLabelText('Sucursal del rol 1'));
    await user.click(await screen.findByRole('option', { name: 'Norte' }));
    await user.click(within(dialog).getByRole('button', { name: 'Crear cuenta' }));

    expect(
      await screen.findByText(
        'Cuenta creada. nuevo@demo.local va a recibir el correo para activarla.',
      ),
    ).toBeInTheDocument();
    expect(sent).toStrictEqual({
      email: 'nuevo@demo.local',
      nombre: 'Nuevo Vendedor',
      roles: [{ rol: 'VO', sucursalId: NORTE }],
    });
    await dialogClosed();
    const row = (await screen.findByText('Nuevo Vendedor · nuevo@demo.local')).closest('tr');
    if (!row) throw new Error('No se encontró la fila del usuario.');
    expect(within(row).getByText('VO · Norte')).toBeInTheDocument();
    expect(within(row).getByText('Pendiente de activación')).toBeInTheDocument();
  });
});

describe('[RF-135] parámetros y métodos de pago', () => {
  it('el AC modifica el recargo de un método de pago', async () => {
    const methods: PaymentMethod[] = [
      {
        id: 'tc',
        nombre: 'Tarjeta de crédito',
        tipo: 'electronico',
        recargoPct: '10.0000',
        activo: true,
      },
    ];
    mockAc({
      'GET /organizacion/parametros': () => ({
        status: 200,
        body: {
          inactividadCarritoMin: 15,
          inactividadSesionMin: 30,
          plazoRegularizacionHoras: 72,
          plazoDevolucionDias: 30,
          toleranciaArqueo: '0.00',
          politicaFacturacion: 'siempre',
          plazoFacturacionPosteriorDias: 0,
        },
      }),
      'GET /organizacion/metodos-pago': () => ({ status: 200, body: methods }),
      'PATCH /organizacion/metodos-pago/tc': (body) => {
        const method = methods[0];
        if (method) method.recargoPct = `${(body as { recargoPct: string }).recargoPct}.0000`;
        return { status: 200, body: method };
      },
    });
    renderApp('/admin/parametros');
    const user = userEvent.setup();

    const row = (await screen.findByText('Tarjeta de crédito')).closest('tr');
    if (!row) throw new Error('No se encontró la fila del método.');
    expect(within(row).getByText('+10 %')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Recargo' }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText(/Recargo/);
    await user.clear(input);
    await user.type(input, '12');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(
      await screen.findByText('Recargo de Tarjeta de crédito actualizado.'),
    ).toBeInTheDocument();
    await dialogClosed();
    expect(await screen.findByText('+12 %')).toBeInTheDocument();
  });

  it('muestra el rechazo de un parámetro fuera de los márgenes', async () => {
    mockAc({
      'GET /organizacion/parametros': () => ({
        status: 200,
        body: {
          inactividadCarritoMin: 15,
          inactividadSesionMin: 30,
          plazoRegularizacionHoras: 72,
          plazoDevolucionDias: 30,
          toleranciaArqueo: '0.00',
          politicaFacturacion: 'siempre',
          plazoFacturacionPosteriorDias: 0,
        },
      }),
      'GET /organizacion/metodos-pago': () => ({ status: 200, body: [] }),
      'PATCH /organizacion/parametros': () => ({
        status: 409,
        body: {
          codigo: 'PARAMETRO_FUERA_DE_MARGEN',
          mensaje: 'La inactividad del carrito tiene que estar entre 2 y 120.',
        },
      }),
    });
    renderApp('/admin/parametros');
    const user = userEvent.setup();

    const field = await screen.findByLabelText('Inactividad del carrito (min)');
    await waitFor(() => {
      expect(field).toHaveValue(15);
    });
    await user.clear(field);
    await user.type(field, '500');
    await user.click(screen.getByRole('button', { name: 'Guardar parámetros' }));

    expect(
      await screen.findByText('La inactividad del carrito tiene que estar entre 2 y 120.'),
    ).toBeInTheDocument();
  });
});
