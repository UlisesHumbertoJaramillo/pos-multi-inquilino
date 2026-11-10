import type {
  BranchSellerQuotas,
  DiscountCap,
  SellerQuotaRequest,
  SessionTokens,
  TransferBranch,
} from '@pos/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockApi, renderApp } from '../../test/render';

const later = () => new Date(Date.now() + 5 * 60_000).toISOString();

const session = (role: 'AC' | 'AS'): SessionTokens => ({
  tokenAcceso: 'a.b.c',
  tokenAccesoVenceEn: later(),
  tokenRenovacion: `renovacion-del-${role.toLowerCase()}-0123456789`,
  sesionVenceEn: later(),
  usuario: {
    id: role === 'AS' ? 'as' : 'ac',
    email: `${role.toLowerCase()}@demo.local`,
    nombre: role === 'AS' ? 'Sergio' : 'Ana',
    comercioId: 'demo',
    moduloFacturacion: true,
    nombreComercio: 'Demo',
    detalleSucursales: [],
    roles: [role],
    rolActivo: role,
    sucursales: role === 'AS' ? ['centro'] : [],
  },
  requiereElegirRol: false,
});

const BRANCHES: TransferBranch[] = [{ id: 'centro', nombre: 'Centro', propia: true }];

beforeEach(() => {
  sessionStorage.clear();
});

describe('[RF-063] tope de cuota del AC', () => {
  it('el AC cambia el tope y ve cuántas cuotas se recortaron', async () => {
    const tokens = session('AC');
    let cap: DiscountCap = { porcentajeMaximo: '15.0000', montoMaximo: '20000.00' };
    sessionStorage.setItem('pos.tokenRenovacion', tokens.tokenRenovacion);
    mockApi({
      'POST /auth/renovar': () => ({ status: 200, body: tokens }),
      'GET /cuota/tope': () => ({ status: 200, body: cap }),
      'PUT /cuota/tope': (body) => {
        cap = body as DiscountCap;
        return { status: 200, body: { tope: cap, cuotasRecortadas: 2 } };
      },
    });
    renderApp('/admin/cuota');
    const user = userEvent.setup();

    const percent = await screen.findByLabelText('Porcentaje máximo por venta');
    await waitFor(() => {
      expect(percent).toHaveValue('15');
    });
    await user.clear(percent);
    await user.type(percent, '10');
    await user.click(screen.getByRole('button', { name: 'Guardar tope' }));

    expect(
      await screen.findByText(
        'Tope de cuota guardado. Se recortaron 2 cuotas de vendedores que lo superaban.',
      ),
    ).toBeInTheDocument();
    expect(cap).toEqual({ porcentajeMaximo: '10', montoMaximo: '20000.00' });
  });
});

describe('[RF-064] cuotas de los VO', () => {
  it('el AS asigna una cuota al VO y no puede asignarse la suya', async () => {
    const tokens = session('AS');
    let sent: SellerQuotaRequest | undefined;
    const quotas: BranchSellerQuotas = {
      tope: { porcentajeMaximo: '15.0000', montoMaximo: '20000.00' },
      vendedores: [
        {
          usuarioId: 'vo',
          nombre: 'Valeria',
          email: 'vo@demo.local',
          porcentajeMaximo: '0.0000',
          monto: '0.00',
          asignada: false,
          saldo: null,
        },
        {
          usuarioId: 'as',
          nombre: 'Sergio',
          email: 'as@demo.local',
          porcentajeMaximo: '0.0000',
          monto: '0.00',
          asignada: false,
          saldo: null,
        },
      ],
    };
    sessionStorage.setItem('pos.tokenRenovacion', tokens.tokenRenovacion);
    mockApi({
      'POST /auth/renovar': () => ({ status: 200, body: tokens }),
      'GET /inventario/sucursales': () => ({ status: 200, body: BRANCHES }),
      'GET /cuota/sucursales/centro/vendedores': () => ({ status: 200, body: quotas }),
      'PUT /cuota/sucursales/centro/vendedores/vo': (body) => {
        sent = body as SellerQuotaRequest;
        const seller = quotas.vendedores[0];
        if (!seller) throw new Error('Falta el vendedor.');
        Object.assign(seller, { porcentajeMaximo: '10.0000', monto: '5000.00', asignada: true });
        return { status: 200, body: seller };
      },
    });
    renderApp('/admin/cuotas');
    const user = userEvent.setup();

    const table = await screen.findByRole('table', { name: 'Cuotas de los vendedores' });
    const voRow = (await within(table).findByText('Valeria')).closest('tr');
    const asRow = within(table).getByText('Sergio').closest('tr');
    if (!voRow || !asRow) throw new Error('Faltan las filas.');
    expect(within(asRow).queryByRole('button', { name: 'Asignar cuota' })).not.toBeInTheDocument();

    await user.click(within(voRow).getByRole('button', { name: 'Asignar cuota' }));
    const dialog = await screen.findByRole('dialog');
    const percent = within(dialog).getByLabelText('Porcentaje máximo por venta');
    await user.clear(percent);
    await user.type(percent, '10');
    const amount = within(dialog).getByLabelText('Monto por día');
    await user.clear(amount);
    await user.type(amount, '5000');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Cuota de Valeria guardada.')).toBeInTheDocument();
    expect(sent).toEqual({ porcentajeMaximo: '10', monto: '5000' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await within(voRow).findByText('10 %')).toBeInTheDocument();
  });
});
