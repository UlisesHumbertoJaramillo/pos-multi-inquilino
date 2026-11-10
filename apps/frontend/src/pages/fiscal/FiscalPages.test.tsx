import type { SessionTokens, Voucher, VoucherOverview } from '@pos/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockApi, renderApp } from '../../test/render';

const later = () => new Date(Date.now() + 5 * 60_000).toISOString();

const session = (role: 'AC' | 'AS'): SessionTokens => ({
  tokenAcceso: 'a.b.c',
  tokenAccesoVenceEn: later(),
  tokenRenovacion: 'renovacion-0123456789-abcdef',
  sesionVenceEn: later(),
  usuario: {
    id: 'u',
    email: 'u@demo.local',
    nombre: 'Ana',
    comercioId: 'demo',
    moduloFacturacion: true,
    roles: [role],
    rolActivo: role,
    sucursales: ['centro'],
  },
  requiereElegirRol: false,
});

const REJECTED: Voucher = {
  id: 'v1',
  tipo: 'factura',
  clase: 'B',
  ventaId: 'venta1',
  numeroTicket: 12,
  puntoVenta: 1,
  numero: 3,
  total: '1000.00',
  comprador: null,
  estado: 'rechazado',
  contingencia: false,
  noFiscal: true,
  cae: null,
  caea: null,
  motivoRechazo: 'CUIT inválido',
  intentos: 1,
  emitidoEn: '2026-11-02T12:00:00Z',
  plazoVence: '2026-11-05T12:00:00Z',
};

beforeEach(() => {
  sessionStorage.clear();
});

describe('[RF-104] [RF-103] comprobantes', () => {
  it('muestra el rechazo con su alerta y lo reenvía', async () => {
    const overview: VoucherOverview = {
      comprobantes: [REJECTED],
      alertas: [
        {
          id: 'a1',
          tipo: 'comprobante_rechazado',
          severidad: 'critica',
          detalle: { motivo: 'CUIT inválido' },
          creadaEn: '2026-11-02T12:00:00Z',
        },
      ],
    };
    sessionStorage.setItem('pos.tokenRenovacion', session('AS').tokenRenovacion);
    mockApi({
      'POST /auth/renovar': () => ({ status: 200, body: session('AS') }),
      'GET /fiscal/comprobantes': () => ({ status: 200, body: overview }),
      'POST /fiscal/comprobantes/v1/reenvio': () => {
        const accepted: Voucher = {
          ...REJECTED,
          estado: 'aceptado',
          cae: '1',
          motivoRechazo: null,
        };
        overview.comprobantes = [accepted];
        overview.alertas = [];
        return { status: 200, body: accepted };
      },
    });
    renderApp('/admin/comprobantes');
    const user = userEvent.setup();

    expect(await screen.findByText('Comprobante rechazado: CUIT inválido')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Comprobantes' });
    await user.click(within(table).getByRole('button', { name: 'Reenviar' }));
    expect(await screen.findByText('Comprobante reenviado.')).toBeInTheDocument();
    expect(await within(table).findByText('Emitido')).toBeInTheDocument();
  });

  it('sin el módulo activo informa el motivo', async () => {
    sessionStorage.setItem('pos.tokenRenovacion', session('AS').tokenRenovacion);
    mockApi({
      'POST /auth/renovar': () => ({ status: 200, body: session('AS') }),
      'GET /fiscal/comprobantes': () => ({
        status: 409,
        body: {
          codigo: 'MODULO_FISCAL_INACTIVO',
          mensaje: 'El comercio no tiene activo el módulo de facturación.',
        },
      }),
    });
    renderApp('/admin/comprobantes');
    expect(
      await screen.findByText('El comercio no tiene activo el módulo de facturación.'),
    ).toBeInTheDocument();
  });
});

describe('[RF-162] configuración fiscal', () => {
  it('muestra solo el vencimiento del certificado', async () => {
    sessionStorage.setItem('pos.tokenRenovacion', session('AC').tokenRenovacion);
    mockApi({
      'POST /auth/renovar': () => ({ status: 200, body: session('AC') }),
      'GET /fiscal/configuracion': () => ({
        status: 200,
        body: {
          cuit: '20123456789',
          condicionFiscal: 'responsable_inscripto',
          certificadoVenceEn: '2030-01-15T12:00:00Z',
        },
      }),
    });
    renderApp('/admin/fiscal');
    expect(await screen.findByText(/Certificado de 20123456789: vence el/)).toBeInTheDocument();
  });
});
