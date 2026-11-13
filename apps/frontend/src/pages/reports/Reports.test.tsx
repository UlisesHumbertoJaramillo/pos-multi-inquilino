import type { DailyReport, Dashboard, RoleAlert, SessionTokens, Structure } from '@pos/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FakeWebSocket } from '../../test/realtime';
import { mockApi, renderApp } from '../../test/render';

const later = () => new Date(Date.now() + 5 * 60_000).toISOString();

const sessionOf = (role: 'AC' | 'AS'): SessionTokens => ({
  tokenAcceso: 'a.b.c',
  tokenAccesoVenceEn: later(),
  tokenRenovacion: `renovacion-${role}-0123456789`,
  sesionVenceEn: later(),
  usuario: {
    id: role,
    email: `${role}@demo.local`,
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
});

const STRUCTURE: Structure = {
  comercio: { id: 'demo', nombre: 'Demo' },
  sucursales: [
    { id: 'centro', nombre: 'Centro', direccion: null, activa: true, cajas: [] },
    { id: 'norte', nombre: 'Norte', direccion: null, activa: true, cajas: [] },
  ],
};

const totals = { total: '7000.00', tickets: 4, promedio: '1750.00' };

const DASHBOARD: Dashboard = {
  desde: '2026-10-04',
  hasta: '2026-11-02',
  sucursalId: null,
  ventas: totals,
  devoluciones: { cantidad: 1, valor: '1000.00', reintegro: '1000.00' },
  anulaciones: { cantidad: 1, total: '1000.00', reintegro: '1000.00' },
  porMedio: [{ metodo: 'Efectivo', tipo: 'efectivo', monto: '5000.00', recargo: '0.00' }],
  porVendedor: [{ vendedorId: 'vo', vendedor: 'Valeria', tickets: 4, total: '7000.00' }],
  porProducto: [{ productoId: 'agua', nombre: 'Agua', cantidad: '7.000', total: '7000.00' }],
  porDia: [{ fecha: '2026-11-02', total: '7000.00', tickets: 4 }],
  arqueos: [],
  bajoMinimo: [{ sucursal: 'Norte', producto: 'Agua', disponible: '99.000', umbral: '200.000' }],
  comprobantesSinRegularizar: null,
  alertas: { criticas: 0, advertencias: 1, informativas: 0 },
  anterior: {
    desde: '2026-09-04',
    hasta: '2026-10-03',
    ventas: { total: '5000.00', tickets: 5, promedio: '1000.00' },
  },
  variacion: { total: '40.0', tickets: '-20.0', promedio: '75.0' },
  serieDiaria: [
    { fecha: '2026-11-01', total: '0.00', tickets: 0 },
    { fecha: '2026-11-02', total: '7000.00', tickets: 4 },
  ],
  masVendidos: [{ productoId: 'agua', nombre: 'Agua', cantidad: '7.000', total: '7000.00' }],
  atencion: { arqueosConDiferencia: 0, bajoMinimo: 1, comprobantesSinRegularizar: null },
};

function withSession(role: 'AC' | 'AS', handlers: Parameters<typeof mockApi>[0]) {
  sessionStorage.setItem('pos.tokenRenovacion', sessionOf(role).tokenRenovacion);
  return mockApi({
    'POST /auth/renovar': () => ({ status: 200, body: sessionOf(role) }),
    'GET /alertas': () => ({ status: 200, body: [] }),
    'GET /alertas/resumen': () => ({
      status: 200,
      body: { cantidad: 0, severidadMaxima: null },
    }),
    ...handlers,
  });
}

const calls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.map(([input]) => {
    const url = new URL(input instanceof Request ? input.url : input);
    return `${url.pathname}${url.search}`;
  });

describe('[RF-110] [RF-186] [RF-187] dashboard del AC', () => {
  it('muestra las métricas del backend y filtra por sucursal', async () => {
    const fetchMock = withSession('AC', {
      'GET /organizacion/estructura': () => ({ status: 200, body: STRUCTURE }),
      'GET /reportes/dashboard': () => ({ status: 200, body: DASHBOARD }),
    });
    renderApp('/admin/dashboard');
    const user = userEvent.setup();

    const metrics = await screen.findByLabelText('Métricas');
    // Primer nivel: los indicadores con su variación, lo que requiere atención y las gráficas.
    expect(within(metrics).getByText('Ventas (brutas)')).toBeInTheDocument();
    expect(within(metrics).getByText('$ 1.750,00')).toBeInTheDocument();
    expect(within(metrics).getByText('+40,0 %')).toBeInTheDocument();
    expect(within(metrics).getByText('−20,0 %')).toBeInTheDocument();
    expect(
      within(metrics).getByRole('group', { name: 'Advertencia: 1 productos bajo el stock mínimo' }),
    ).toBeInTheDocument();
    expect(within(metrics).getByLabelText('Ventas por día')).toBeInTheDocument();
    expect(within(metrics).getByLabelText('Los 5 más vendidos')).toBeInTheDocument();
    // Las tablas densas no están en el primer nivel.
    expect(within(metrics).queryByRole('table')).toBeNull();

    // Segundo nivel: el punto de atención abre su detalle.
    await user.click(within(metrics).getByRole('button', { name: 'Ver los productos' }));
    const detail = await screen.findByRole('presentation');
    expect(
      await within(detail).findByRole('table', { name: 'Productos bajo el stock mínimo' }),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(screen.queryByRole('presentation')).toBeNull();
    });

    // Un indicador abre el detalle de las ventas del período.
    await user.click(within(metrics).getByRole('button', { name: /^Ventas \(brutas\)/ }));
    expect(await screen.findByRole('table', { name: 'Ventas por día' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(screen.queryByRole('presentation')).toBeNull();
    });

    await user.click(screen.getByLabelText('Sucursal'));
    await user.click(await screen.findByRole('option', { name: 'Norte' }));
    await vi.waitFor(() => {
      expect(calls(fetchMock)).toContain('/reportes/dashboard?sucursalId=norte');
    });
  });
});

describe('[RF-109] informe diario del AS', () => {
  it('muestra el informe de su sucursal', async () => {
    const report: DailyReport = {
      sucursal: { id: 'centro', nombre: 'Centro' },
      fechaJornada: '2026-11-02',
      ventas: { total: '2000.00', tickets: 1, promedio: '2000.00' },
      porMedio: [],
      porVendedor: [],
      porTurno: [],
      devoluciones: { cantidad: 0, valor: '0.00', reintegro: '0.00' },
      anulaciones: { cantidad: 0, total: '0.00', reintegro: '0.00' },
      arqueos: [],
      comprobantesSinRegularizar: null,
    };
    const fetchMock = withSession('AS', {
      'GET /inventario/sucursales': () => ({
        status: 200,
        body: [
          { id: 'centro', nombre: 'Centro', propia: true },
          { id: 'norte', nombre: 'Norte', propia: false },
        ],
      }),
      'GET /reportes/sucursales/centro/informe-diario': () => ({ status: 200, body: report }),
    });
    renderApp('/admin/informe');
    expect(await screen.findByText(/Centro · jornada del 2026-11-02/)).toBeInTheDocument();
    expect(calls(fetchMock)).toContain('/reportes/sucursales/centro/informe-diario');
  });
});

describe('[RF-127] [RF-189] centro de alertas', () => {
  it('resuelve una crítica con la nota que pide el backend y se actualiza en vivo', async () => {
    const critical: RoleAlert = {
      id: 'alerta1',
      tipo: 'reintegro_pendiente',
      severidad: 'critica',
      persistente: true,
      sucursalId: 'centro',
      sucursal: 'Centro',
      destinatarioRol: 'AS',
      referencia: null,
      detalle: { monto: '500.00' },
      creadaEn: '2026-11-02T12:00:00Z',
      ultimoRecordatorio: null,
      resolubleAMano: true,
    };
    let alerts: RoleAlert[] = [critical];
    const notes: unknown[] = [];
    withSession('AS', {
      'GET /alertas': () => ({ status: 200, body: alerts }),
      'GET /alertas/resumen': () => ({
        status: 200,
        body: {
          cantidad: alerts.length,
          severidadMaxima: alerts.some((a) => a.severidad === 'critica')
            ? 'critica'
            : (alerts[0]?.severidad ?? null),
        },
      }),
      'POST /alertas/alerta1/resolucion': (body) => {
        notes.push(body);
        if ((body as { nota?: string }).nota === undefined) {
          return {
            status: 409,
            body: { codigo: 'NOTA_REQUERIDA', mensaje: 'Contá qué se hizo.' },
          };
        }
        alerts = [];
        return { status: 204 };
      },
    });
    renderApp('/admin');
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole('button', { name: 'Alertas (1), la más grave: Crítica' }),
    );
    const drawer = await screen.findByLabelText('Alertas');
    expect(within(drawer).getByText(/aprobó tarde un pago de \$ 500,00/)).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: 'Resolver' }));
    const dialog = await screen.findByRole('dialog', { name: 'Resolver la alerta' });
    await user.type(within(dialog).getByLabelText('Qué se hizo para corregirla'), 'Transferido');
    await user.click(within(dialog).getByRole('button', { name: 'Resolver' }));
    expect(await within(drawer).findByText('No hay alertas pendientes.')).toBeInTheDocument();
    expect(notes).toEqual([{}, { nota: 'Transferido' }]);

    // Una alerta nueva llega por el canal en vivo.
    alerts = [
      {
        ...critical,
        id: 'alerta2',
        tipo: 'transferencia_faltante',
        severidad: 'advertencia',
        detalle: { items: [] },
      },
    ];
    FakeWebSocket.latest()?.receive({ tipo: 'alertas' });
    expect(await within(drawer).findByText(/llegó con faltante/)).toBeInTheDocument();
    // Una advertencia no se destaca sobre la pantalla.
    expect(screen.queryByTestId('alerta-critica')).toBeNull();
    expect(
      // El panel abierto oculta el resto de la pantalla a los lectores: se busca igual.
      await screen.findByRole('button', {
        name: 'Alertas (1), la más grave: Advertencia',
        hidden: true,
      }),
    ).toBeInTheDocument();
  });

  it('[RF-190] una crítica que llega en vivo queda destacada hasta que se atiende', async () => {
    const critical: RoleAlert = {
      id: 'alerta9',
      tipo: 'reintegro_pendiente',
      severidad: 'critica',
      persistente: true,
      sucursalId: 'centro',
      sucursal: 'Centro',
      destinatarioRol: 'AS',
      referencia: null,
      detalle: { monto: '800.00' },
      creadaEn: '2026-11-02T12:00:00Z',
      ultimoRecordatorio: null,
      resolubleAMano: true,
    };
    let alerts: RoleAlert[] = [];
    withSession('AS', {
      'GET /alertas': () => ({ status: 200, body: alerts }),
      'GET /alertas/resumen': () => ({
        status: 200,
        body: { cantidad: alerts.length, severidadMaxima: alerts.length ? 'critica' : null },
      }),
    });
    renderApp('/admin');
    const user = userEvent.setup();
    expect(await screen.findByRole('button', { name: 'Alertas (0)' })).toBeInTheDocument();
    expect(screen.queryByTestId('alerta-critica')).toBeNull();

    alerts = [critical];
    FakeWebSocket.latest()?.receive({ tipo: 'alertas' });
    const notice = await screen.findByTestId('alerta-critica');
    expect(notice).toHaveTextContent(/800,00/);
    expect(
      await screen.findByRole('button', { name: 'Alertas (1), la más grave: Crítica' }),
    ).toBeInTheDocument();

    // No se va sola: queda hasta que alguien la atiende.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByTestId('alerta-critica')).toBeVisible();
    await user.click(within(notice).getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByTestId('alerta-critica')).toBeNull();
  });
});
