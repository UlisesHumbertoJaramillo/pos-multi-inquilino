import type {
  Category,
  Combo,
  PriceList,
  PriceSheet,
  Product,
  ProductCreateRequest,
  SessionTokens,
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
    roles: ['AC'],
    rolActivo: 'AC',
    sucursales: [],
  },
  requiereElegirRol: false,
};

const BEBIDAS: Category = { id: 'cat-beb', nombre: 'Bebidas', tasaIva: '21.0000', activa: true };

function product(overrides: Partial<Product>): Product {
  return {
    id: 'p',
    tipo: 'simple',
    nombre: 'Producto',
    codigoBarras: null,
    categoriaId: BEBIDAS.id,
    costo: '100.00',
    precioCombo: null,
    activo: true,
    tieneImagen: false,
    disponible: true,
    ...overrides,
  };
}

function mockAc(handlers: Record<string, ApiHandler>) {
  sessionStorage.setItem('pos.tokenRenovacion', AC_SESSION.tokenRenovacion);
  return mockApi({ 'POST /auth/renovar': () => ({ status: 200, body: AC_SESSION }), ...handlers });
}

async function dialogClosed() {
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
}

beforeEach(() => {
  sessionStorage.clear();
});

describe('[RF-130] [RF-159] catálogo del AC', () => {
  it('el AC crea un producto con imagen', async () => {
    const products: Product[] = [];
    let created: ProductCreateRequest | undefined;
    const api = mockAc({
      'GET /catalogo/categorias': () => ({ status: 200, body: [BEBIDAS] }),
      'GET /catalogo/productos': () => ({ status: 200, body: products }),
      'POST /catalogo/productos': (body) => {
        created = body as ProductCreateRequest;
        const p = product({ id: 'nuevo', nombre: created.nombre, costo: '350.00' });
        products.push(p);
        return { status: 201, body: p };
      },
      'PUT /catalogo/productos/nuevo/imagen': () => {
        const [p] = products;
        if (p) p.tieneImagen = true;
        return { status: 204 };
      },
      'GET /catalogo/productos/nuevo/imagen': () => ({ status: 200, body: 'imagen' }),
    });
    URL.createObjectURL = () => 'blob:imagen';
    URL.revokeObjectURL = () => undefined;
    renderApp('/admin/catalogo');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Nuevo producto' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Nombre/), 'Agua 500 ml');
    await user.type(within(dialog).getByLabelText(/Código de barras/), '7790001');
    await user.type(within(dialog).getByLabelText(/Costo sin IVA/), '350');
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'agua.png', {
      type: 'image/png',
    });
    await user.upload(within(dialog).getByLabelText('Imagen del producto'), file);
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Producto «Agua 500 ml» creado.')).toBeInTheDocument();
    expect(created).toStrictEqual({
      nombre: 'Agua 500 ml',
      codigoBarras: '7790001',
      categoriaId: BEBIDAS.id,
      costo: '350',
    });
    const upload = api.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(upload?.[1]?.body).toBe(file);
    expect(new Headers(upload?.[1]?.headers).get('Content-Type')).toBe('image/png');
    await dialogClosed();
    expect(await screen.findByRole('img', { name: 'Imagen de Agua 500 ml' })).toHaveAttribute(
      'src',
      'blob:imagen',
    );
  });
});

describe('[RF-028] [RF-119] [RF-033] listas de precios', () => {
  it('el AC cambia la regla de una lista y ve los precios recalculados', async () => {
    const list: PriceList = {
      id: 'lista-1',
      nombre: 'Minorista',
      regla: { tipo: 'porcentaje_costo', porcentaje: '40.0000' },
      activa: true,
    };
    let price = '169.40';
    mockAc({
      'GET /catalogo/listas': () => ({ status: 200, body: [list] }),
      'GET /catalogo/sucursales': () => ({
        status: 200,
        body: [{ sucursalId: 'centro', nombre: 'Centro', listaId: list.id }],
      }),
      'GET /catalogo/categorias': () => ({ status: 200, body: [BEBIDAS] }),
      'PATCH /catalogo/listas/lista-1': (body) => {
        list.regla = (body as { regla: PriceList['regla'] }).regla;
        // El backend recalcula: 100 × 1,50 × 1,21.
        price = '181.50';
        return { status: 200, body: list };
      },
      'GET /catalogo/listas/lista-1/precios': () => ({
        status: 200,
        body: {
          lista: list,
          precios: [
            {
              productoId: 'agua',
              nombre: 'Agua',
              codigoBarras: null,
              tipo: 'simple',
              categoria: 'Bebidas',
              precioFinal: price,
            },
          ],
        } satisfies PriceSheet,
      }),
    });
    renderApp('/admin/listas');
    const user = userEvent.setup();

    const table = await screen.findByRole('table', { name: 'Listas de precios' });
    const row = (await within(table).findByText('Minorista')).closest('tr');
    if (!row) throw new Error('No se encontró la fila de la lista.');
    expect(within(row).getByText('Costo + 40 % + IVA')).toBeInTheDocument();
    expect(screen.getByLabelText('Lista de Centro')).toHaveTextContent('Minorista');

    await user.click(within(row).getByRole('button', { name: 'Regla' }));
    const dialog = await screen.findByRole('dialog');
    const margin = within(dialog).getByLabelText(/Margen sobre el costo/);
    await user.clear(margin);
    await user.type(margin, '50');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(
      await screen.findByText('Lista «Minorista» modificada. Sus precios se recalcularon.'),
    ).toBeInTheDocument();
    await dialogClosed();
    await user.click(within(row).getByRole('button', { name: 'Precios' }));
    const prices = await screen.findByRole('dialog');
    expect(within(prices).getByText('$ 181,50')).toBeInTheDocument();
  });

  it('la vista imprimible agrupa los precios por categoría', async () => {
    mockAc({
      'GET /catalogo/listas/lista-1/precios': () => ({
        status: 200,
        body: {
          lista: {
            id: 'lista-1',
            nombre: 'Minorista',
            regla: { tipo: 'porcentaje_costo', porcentaje: '40.0000' },
            activa: true,
          },
          precios: [
            {
              productoId: 'agua',
              nombre: 'Agua',
              codigoBarras: '7790001',
              tipo: 'simple',
              categoria: 'Bebidas',
              precioFinal: '169.40',
            },
            {
              productoId: 'combo',
              nombre: 'Combo merienda',
              codigoBarras: null,
              tipo: 'combo',
              categoria: null,
              precioFinal: '3500.00',
            },
          ],
        } satisfies PriceSheet,
      }),
    });
    renderApp('/admin/listas/lista-1/imprimir');

    expect(
      await screen.findByRole('heading', { name: 'Lista de precios: Minorista' }),
    ).toBeInTheDocument();
    const bebidas = screen.getByRole('table', { name: 'Precios de Bebidas' });
    expect(within(bebidas).getByText('$ 169,40')).toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Precios de Combos' })).getByText('$ 3.500,00'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeInTheDocument();
  });
});

describe('[RF-149] combos', () => {
  it('un combo con un componente dado de baja se muestra no disponible', async () => {
    const combo: Combo = {
      ...product({ id: 'combo', tipo: 'combo', nombre: 'Combo merienda', categoriaId: null }),
      costo: null,
      precioCombo: '3500.00',
      disponible: false,
      componentes: [
        { productoId: 'leche', nombre: 'Leche', cantidad: '1.000', activo: true },
        { productoId: 'galle', nombre: 'Galletitas', cantidad: '2.000', activo: false },
      ],
    };
    mockAc({
      'GET /catalogo/combos': () => ({ status: 200, body: [combo] }),
      'GET /catalogo/productos': () => ({ status: 200, body: [product({ id: 'leche' })] }),
    });
    renderApp('/admin/combos');

    const row = (await screen.findByText('Combo merienda')).closest('tr');
    if (!row) throw new Error('No se encontró la fila del combo.');
    expect(within(row).getByText('1 × Leche, 2 × Galletitas (baja)')).toBeInTheDocument();
    expect(within(row).getByText('No disponible')).toBeInTheDocument();
    expect(within(row).getByText('$ 3.500,00')).toBeInTheDocument();
  });
});
