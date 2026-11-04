import type {
  CashMovement,
  CashRegisterStatus,
  CashShift,
  OwnShift,
  SessionTokens,
  ShiftClosure,
  TransferBranch,
} from '@pos/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockApi, renderApp } from '../../test/render';

const later = () => new Date(Date.now() + 5 * 60_000).toISOString();

const session = (role: 'VO' | 'AS'): SessionTokens => ({
  tokenAcceso: 'a.b.c',
  tokenAccesoVenceEn: later(),
  tokenRenovacion: `renovacion-del-${role.toLowerCase()}-0123456789`,
  sesionVenceEn: later(),
  usuario: {
    id: role === 'VO' ? 'vo' : 'as',
    email: `${role.toLowerCase()}@demo.local`,
    nombre: role === 'VO' ? 'Valeria' : 'Sergio',
    comercioId: 'demo',
    roles: [role],
    rolActivo: role,
    sucursales: ['centro'],
  },
  requiereElegirRol: false,
});

const REGISTER: CashRegisterStatus = {
  id: 'caja1',
  nombre: 'Caja 1',
  jornada: null,
  turnoAbierto: null,
  requiereCorteZ: false,
};

const shift = (overrides: Partial<CashShift> = {}): CashShift => ({
  id: 'turno1',
  cajaId: 'caja1',
  caja: 'Caja 1',
  sucursalId: 'centro',
  jornadaId: 'j1',
  fechaJornada: '2026-11-03',
  vendedorId: 'vo',
  vendedor: 'Valeria',
  saldoInicial: '1000.00',
  diferenciaInicial: null,
  abiertoEn: '2026-11-03T12:00:00Z',
  estado: 'abierto',
  forzado: false,
  ...overrides,
});

const movement = (overrides: Partial<CashMovement>): CashMovement => ({
  id: 'm1',
  tipo: 'retiro',
  enEfectivo: true,
  monto: '300.00',
  motivo: 'Depósito',
  registradoEn: '2026-11-03T12:10:00Z',
  ...overrides,
});

function signedIn(role: 'VO' | 'AS') {
  const tokens = session(role);
  sessionStorage.setItem('pos.tokenRenovacion', tokens.tokenRenovacion);
  return { 'POST /auth/renovar': () => ({ status: 200, body: tokens }) };
}

beforeEach(() => {
  sessionStorage.clear();
});

describe('[RF-089] [RF-092] caja del VO', () => {
  it('el VO abre un turno y registra un retiro autorizado con el PIN del AS', async () => {
    const own: OwnShift = { turno: null, movimientos: [] };
    let authorization: Record<string, unknown> | undefined;
    let withdrawal: Record<string, unknown> | undefined;
    mockApi({
      ...signedIn('VO'),
      'GET /caja/turno': () => ({ status: 200, body: own }),
      'GET /caja/sucursales/centro/cajas': () => ({ status: 200, body: [REGISTER] }),
      'POST /caja/turnos': (body) => {
        own.turno = shift({ saldoInicial: (body as { saldoInicial: string }).saldoInicial });
        return { status: 201, body: own.turno };
      },
      'GET /autorizaciones/autorizantes': () => ({
        status: 200,
        body: [{ id: 'as', nombre: 'Sergio', rol: 'AS' }],
      }),
      'POST /autorizaciones': (body) => {
        authorization = body as Record<string, unknown>;
        return { status: 201, body: { id: 'aut1' } };
      },
      'POST /caja/turno/retiros': (body) => {
        withdrawal = body as Record<string, unknown>;
        own.movimientos.push(movement({}));
        return { status: 201, body: movement({}) };
      },
    });
    renderApp('/pos');
    const user = userEvent.setup();

    const card = await screen.findByLabelText('Caja 1');
    await user.click(within(card).getByRole('button', { name: 'Abrir turno' }));
    let dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Saldo inicial'), '1000');
    await user.click(within(dialog).getByRole('button', { name: 'Abrir turno' }));
    expect(await screen.findByText('Turno abierto.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retiro' }));
    dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Monto'), '300');
    await user.type(within(dialog).getByLabelText('Motivo'), 'Depósito');
    await user.click(within(dialog).getByRole('button', { name: 'Pedir autorización' }));

    dialog = await screen.findByRole('dialog', { name: 'Autorización con PIN' });
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Autoriza')).toHaveTextContent('Sergio (AS)');
    });
    await user.type(within(dialog).getByLabelText('PIN'), '2222');
    await user.click(within(dialog).getByRole('button', { name: 'Autorizar' }));

    expect(await screen.findByText('Retiro registrado.')).toBeInTheDocument();
    expect(authorization).toEqual({
      tipo: 'retiro',
      operacionRef: 'retiro:turno1:300.00',
      sucursalId: 'centro',
      autorizanteId: 'as',
      pin: '2222',
    });
    expect(withdrawal).toEqual({ monto: '300.00', motivo: 'Depósito', autorizacionId: 'aut1' });
    const table = screen.getByRole('table', { name: 'Movimientos del turno' });
    expect(await within(table).findByText('Retiro')).toBeInTheDocument();
  });

  it('[D-80] el VO hace el Corte X a ciegas y no ve el resultado del arqueo', async () => {
    const own: OwnShift = { turno: shift(), movimientos: [] };
    const closure: ShiftClosure = {
      turno: shift({ estado: 'cerrado' }),
      arqueo: { declarado: '950.00' },
    };
    mockApi({
      ...signedIn('VO'),
      'GET /caja/turno': () => ({ status: 200, body: own }),
      'GET /caja/sucursales/centro/cajas': () => ({ status: 200, body: [REGISTER] }),
      'POST /caja/turno/corte-x': () => {
        own.turno = null;
        return { status: 200, body: closure };
      },
    });
    renderApp('/pos');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Corte X' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/Teórico/)).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Efectivo contado'), '950');
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar turno' }));

    const result = await screen.findByRole('dialog', { name: 'Turno cerrado' });
    expect(
      within(result).getByText('Cierre registrado. El resultado del arqueo lo ven el AS y el AC.'),
    ).toBeInTheDocument();
    expect(within(result).getByText('Declarado: $ 950,00')).toBeInTheDocument();
    expect(within(result).queryByText(/Teórico|Diferencia|Faltante/)).not.toBeInTheDocument();
  });
});

describe('[RF-115] caja del AS', () => {
  it('el AS fuerza el cierre de un turno del VO', async () => {
    const branches: TransferBranch[] = [{ id: 'centro', nombre: 'Centro', propia: true }];
    let open = [shift()];
    mockApi({
      ...signedIn('AS'),
      'GET /inventario/sucursales': () => ({ status: 200, body: branches }),
      'GET /caja/sucursales/centro/cajas': () => ({
        status: 200,
        body: [
          {
            ...REGISTER,
            turnoAbierto: open[0]
              ? {
                  id: 'turno1',
                  vendedorId: 'vo',
                  vendedor: 'Valeria',
                  abiertoEn: '2026-11-03T12:00:00Z',
                }
              : null,
          },
        ],
      }),
      'GET /caja/sucursales/centro/turnos-abiertos': () => ({ status: 200, body: open }),
      'GET /inventario/sucursales/centro/alertas': () => ({ status: 200, body: [] }),
      'POST /caja/turnos/turno1/cierre-forzado': () => {
        open = [];
        return {
          status: 200,
          body: {
            turno: shift({ estado: 'cerrado', forzado: true }),
            arqueo: {
              declarado: '1000.00',
              diferencia: '0.00',
              resultado: 'cuadrado',
              teorico: '1000.00',
            },
          },
        };
      },
    });
    renderApp('/admin/caja');
    const user = userEvent.setup();

    const table = await screen.findByRole('table', { name: 'Turnos abiertos' });
    await user.click(await within(table).findByRole('button', { name: 'Forzar cierre' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Efectivo contado'), '1000');
    await user.click(within(dialog).getByRole('button', { name: 'Forzar cierre' }));

    const result = await screen.findByRole('dialog', { name: 'Turno de Valeria cerrado' });
    expect(within(result).getByText('Arqueo: Cuadrado')).toBeInTheDocument();
    expect(within(result).getByText('Teórico: $ 1.000,00')).toBeInTheDocument();
    await user.click(within(result).getByRole('button', { name: 'Listo' }));
    expect(await screen.findByText('No hay turnos abiertos en la sucursal.')).toBeInTheDocument();
  });
});
