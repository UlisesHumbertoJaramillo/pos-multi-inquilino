import type { Customer, SessionTokens } from '@pos/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from '../../test/render';

const later = () => new Date(Date.now() + 5 * 60_000).toISOString();

const SESSION: SessionTokens = {
  tokenAcceso: 'a.b.c',
  tokenAccesoVenceEn: later(),
  tokenRenovacion: 'renovacion-del-as-0123456789',
  sesionVenceEn: later(),
  usuario: {
    id: 'as',
    email: 'as@demo.local',
    nombre: 'Ana',
    comercioId: 'demo',
    roles: ['AS'],
    rolActivo: 'AS',
    sucursales: ['centro'],
  },
  requiereElegirRol: false,
};

const KIOSCO: Customer = {
  id: 'c1',
  razonSocial: 'Kiosco Sur',
  documento: '123',
  condicionFiscal: 'monotributista',
  cuentaCorriente: false,
  limiteCredito: '0.00',
  saldo: '0.00',
  disponible: '0.00',
  activo: true,
};

beforeEach(() => {
  sessionStorage.clear();
});

describe('[RF-132] [RF-072] clientes del AS', () => {
  it('crea un cliente y le fija un límite de crédito', async () => {
    const customers: Customer[] = [];
    let credit: unknown;
    sessionStorage.setItem('pos.tokenRenovacion', SESSION.tokenRenovacion);
    mockApi({
      'POST /auth/renovar': () => ({ status: 200, body: SESSION }),
      'GET /clientes': () => ({ status: 200, body: customers }),
      'POST /clientes': () => {
        customers.push(KIOSCO);
        return { status: 201, body: KIOSCO };
      },
      'PUT /clientes/c1/credito': (body) => {
        credit = body;
        return { status: 200, body: KIOSCO };
      },
    });
    renderApp('/admin/clientes');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Nuevo cliente' }));
    const form = await screen.findByRole('dialog', { name: 'Nuevo cliente' });
    await user.type(within(form).getByLabelText('Razón social'), 'Kiosco Sur');
    await user.click(within(form).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Cliente guardado.')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Crédito' }));
    const dialog = await screen.findByRole('dialog', { name: 'Crédito de Kiosco Sur' });
    await user.click(within(dialog).getByLabelText('Tiene cuenta corriente'));
    const limit = within(dialog).getByLabelText('Límite de crédito');
    await user.clear(limit);
    await user.type(limit, '5000');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => {
      expect(credit).toEqual({ cuentaCorriente: true, limite: '5000' });
    });
  });
});
