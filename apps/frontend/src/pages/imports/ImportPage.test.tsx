import type { ImportSummary, SessionTokens } from '@pos/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi, renderApp } from '../../test/render';

const later = () => new Date(Date.now() + 5 * 60_000).toISOString();

const SESSION: SessionTokens = {
  tokenAcceso: 'a.b.c',
  tokenAccesoVenceEn: later(),
  tokenRenovacion: 'renovacion-ac-0123456789',
  sesionVenceEn: later(),
  usuario: {
    id: 'ac',
    email: 'ac@demo.local',
    nombre: 'Ana',
    comercioId: 'demo',
    moduloFacturacion: false,
    nombreComercio: 'Demo',
    detalleSucursales: [],
    roles: ['AC'],
    rolActivo: 'AC',
    sucursales: [],
  },
  requiereElegirRol: false,
};

const SUMMARY: ImportSummary = {
  creados: 1,
  actualizados: 1,
  rechazados: 1,
  filas: [
    { fila: 2, clave: '7790001', resultado: 'actualizado', motivo: null },
    { fila: 3, clave: '7790002', resultado: 'creado', motivo: null },
    {
      fila: 4,
      clave: '7790003',
      resultado: 'error',
      motivo: 'La categoría «Fiambrería» no existe.',
    },
  ],
};

function signedIn(handlers: Parameters<typeof mockApi>[0]) {
  sessionStorage.setItem('pos.tokenRenovacion', SESSION.tokenRenovacion);
  return mockApi({
    'POST /auth/renovar': () => ({ status: 200, body: SESSION }),
    'GET /alertas': () => ({ status: 200, body: [] }),
    'GET /alertas/resumen': () => ({ status: 200, body: { cantidad: 0, severidadMaxima: null } }),
    ...handlers,
  });
}

const excel = (name = 'productos.xlsx') =>
  new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

describe('[RF-173] carga desde Excel del AC', () => {
  it('muestra la vista previa al elegir el archivo y solo carga al confirmar', async () => {
    let applied = 0;
    signedIn({
      'POST /importaciones/productos/vista-previa': () => ({ status: 200, body: SUMMARY }),
      'POST /importaciones/productos': () => {
        applied += 1;
        return { status: 200, body: SUMMARY };
      },
    });
    renderApp('/admin/carga-excel');
    const user = userEvent.setup();

    await user.upload(await screen.findByLabelText('Archivo de Excel'), excel());
    const preview = await screen.findByLabelText('Vista previa');
    expect(within(preview).getByText('Vista previa: todavía no se cargó nada.')).toBeVisible();
    const rows = within(preview).getByRole('table', { name: 'Filas del archivo' });
    expect(within(rows).getByRole('status', { name: 'Crítica: Se rechaza' })).toBeVisible();
    expect(within(rows).getByText('La categoría «Fiambrería» no existe.')).toBeVisible();
    expect(applied).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Confirmar la carga' }));
    expect(await screen.findByText(/Carga hecha: 1 creados y 1 actualizados/)).toBeVisible();
    expect(applied).toBe(1);
  });

  it('[RF-174] un archivo que el backend rechaza muestra el motivo y no ofrece confirmar', async () => {
    signedIn({
      'POST /importaciones/proveedores/vista-previa': () => ({
        status: 400,
        body: {
          codigo: 'ARCHIVO_CON_MACROS',
          mensaje: 'El archivo tiene macros: guardalo como «Libro de Excel (.xlsx)», sin macros.',
        },
      }),
    });
    renderApp('/admin/carga-excel');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'Proveedores' }));
    await user.upload(screen.getByLabelText('Archivo de Excel'), excel('proveedores.xlsm'));
    expect(await screen.findByText(/El archivo tiene macros/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Confirmar la carga' })).toBeNull();
  });
});
