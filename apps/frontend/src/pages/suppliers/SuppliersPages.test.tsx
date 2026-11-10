import type {
  Purchase,
  PurchaseReceptionRequest,
  SessionTokens,
  Supplier,
  SupplierPaymentRequest,
} from '@pos/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockApi, renderApp, type ApiHandler } from '../../test/render';

const later = () => new Date(Date.now() + 5 * 60_000).toISOString();

function session(role: 'AC' | 'AS'): SessionTokens {
  return {
    tokenAcceso: 'a.b.c',
    tokenAccesoVenceEn: later(),
    tokenRenovacion: `renovacion-${role}-0123456789`,
    sesionVenceEn: later(),
    usuario: {
      id: role,
      email: `${role.toLowerCase()}@demo.local`,
      nombre: role,
      comercioId: 'demo',
      moduloFacturacion: true,
      nombreComercio: 'Demo',
      detalleSucursales: [],
      roles: [role],
      rolActivo: role,
      sucursales: role === 'AS' ? ['centro'] : [],
    },
    requiereElegirRol: false,
  };
}

function mockAs(role: 'AC' | 'AS', handlers: Record<string, ApiHandler>) {
  const tokens = session(role);
  sessionStorage.setItem('pos.tokenRenovacion', tokens.tokenRenovacion);
  return mockApi({ 'POST /auth/renovar': () => ({ status: 200, body: tokens }), ...handlers });
}

const SUR: Supplier = {
  id: 'sur',
  razonSocial: 'Distribuidora del Sur',
  cuit: '30712345671',
  contacto: null,
  saldoAdeudado: '1000.00',
  activo: true,
};

beforeEach(() => {
  sessionStorage.clear();
});

describe('[RF-038] pagos a proveedores', () => {
  it('un pago que supera la deuda pide confirmación antes de registrarse', async () => {
    const bodies: SupplierPaymentRequest[] = [];
    mockAs('AC', {
      'GET /proveedores': () => ({ status: 200, body: [SUR] }),
      'POST /proveedores/sur/pagos': (body) => {
        const request = body as SupplierPaymentRequest;
        bodies.push(request);
        if (!request.confirmarExceso) {
          return {
            status: 409,
            body: {
              codigo: 'PAGO_EXCEDE_DEUDA',
              mensaje: 'El pago de 1500.00 supera el saldo adeudado de 1000.00.',
            },
          };
        }
        return {
          status: 201,
          body: {
            pago: {
              id: 'p',
              monto: '1500.00',
              metodo: 'transferencia',
              comprobante: 'TRF 1',
              confirmadoExceso: true,
              momento: new Date().toISOString(),
            },
            saldoAdeudado: '-500.00',
          },
        };
      },
    });
    renderApp('/admin/proveedores');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Pagar a Distribuidora del Sur' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Monto/), '1500');
    await user.type(within(dialog).getByLabelText(/^Comprobante/), 'TRF 1');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar pago' }));

    expect(
      await within(dialog).findByText('El pago de 1500.00 supera el saldo adeudado de 1000.00.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar pago' }));

    expect(await screen.findByText(/Pago registrado a Distribuidora del Sur/)).toBeInTheDocument();
    expect(bodies.map((b) => b.confirmarExceso ?? false)).toStrictEqual([false, true]);
  });
});

describe('[RF-035] importación de catálogo', () => {
  it('muestra lo importado y las filas rechazadas con su motivo', async () => {
    mockAs('AC', {
      'GET /proveedores': () => ({ status: 200, body: [SUR] }),
      'POST /proveedores/sur/importaciones': () => ({
        status: 200,
        body: {
          id: 'i',
          filasOk: 3,
          creados: 1,
          actualizados: 2,
          preciosRecalculados: 6,
          errores: [{ fila: 5, codigoBarras: '7790', motivo: 'La categoría «Helados» no existe.' }],
        },
      }),
    });
    renderApp('/admin/proveedores');
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole('button', { name: 'Importar catálogo de Distribuidora del Sur' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.upload(
      within(dialog).getByLabelText('Archivo del catálogo'),
      new File(['codigo_barras,nombre,costo,categoria'], 'catalogo.csv', { type: 'text/csv' }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Importar' }));

    expect(
      await within(dialog).findByText(/Se importaron 3 filas: 1 productos nuevos y 2 actualizados/),
    ).toBeInTheDocument();
    const errors = within(dialog).getByRole('table', { name: 'Filas no importadas' });
    expect(within(errors).getByText('La categoría «Helados» no existe.')).toBeInTheDocument();
  });
});

describe('[RF-133] recepción de compras', () => {
  it('el AS recibe una compra con una diferencia', async () => {
    const purchase: Purchase = {
      id: 'c1',
      proveedor: { id: 'sur', razonSocial: 'Distribuidora del Sur' },
      sucursal: { id: 'centro', nombre: 'Centro' },
      estado: 'pendiente',
      comprobante: null,
      total: '1200.00',
      registradaEn: new Date().toISOString(),
      recibidaEn: null,
      items: [
        {
          productoId: 'agua',
          nombre: 'Agua',
          cantidad: '12.000',
          costoUnitario: '100.00',
          subtotal: '1200.00',
          recibida: null,
          diferencia: null,
        },
      ],
    };
    let reception: PurchaseReceptionRequest | undefined;
    mockAs('AS', {
      'GET /recepciones': () => ({ status: 200, body: reception ? [] : [purchase] }),
      'POST /compras/c1/recepcion': (body) => {
        reception = body as PurchaseReceptionRequest;
        return {
          status: 200,
          body: {
            ...purchase,
            estado: 'recibida',
            items: purchase.items.map((i) => ({ ...i, recibida: '10.000', diferencia: '2.000' })),
          },
        };
      },
    });
    renderApp('/admin/recepciones');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Recibir' }));
    const dialog = await screen.findByRole('dialog');
    const received = within(dialog).getByLabelText('Recibidas de Agua');
    await user.clear(received);
    await user.type(received, '10');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar recepción' }));

    expect(
      await screen.findByText('Compra recibida con diferencias: 12 × Agua (faltaron 2).'),
    ).toBeInTheDocument();
    expect(reception).toStrictEqual({ items: [{ productoId: 'agua', recibida: '10' }] });
  });
});
