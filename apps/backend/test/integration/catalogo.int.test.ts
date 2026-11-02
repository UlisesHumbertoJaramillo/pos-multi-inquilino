// Catálogo y precios: categorías, productos, imágenes, listas, combos y asignación (T-072 a T-082).
import type {
  BranchPriceList,
  Category,
  Combo,
  PriceList,
  PriceSheet,
  Product,
} from '@pos/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApi, type TestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerSelect, withAppClient } from '../support/database.js';
import {
  BRANCH_CENTRO,
  BRANCH_NORTE,
  seedIdentity,
  signIn,
  TENANT_B,
  USERS,
} from '../support/identity-fixtures.js';

// Reservas simuladas: cada prueba decide si el producto tiene pendientes (D-42).
let reservations = 0;
const api: TestApi = createTestApi({
  productDependencies: {
    forProduct: () => Promise.resolve({ reservations, pendingPurchases: 0, pendingTransfers: 0 }),
  },
});
afterAll(() => api.close());

let ac: string;

beforeEach(async () => {
  reservations = 0;
  await seedIdentity();
  ac = (await signIn(api.app, USERS.ac.email)).authorization;
});

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

async function post<T>(path: string, body: object, expected = 201): Promise<T> {
  const response = await request(api.app).post(path).set('Authorization', ac).send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(expected);
  return response.body as T;
}

const createCategory = (nombre: string, tasaIva: string) =>
  post<Category>('/catalogo/categorias', { nombre, tasaIva });

const createProduct = (categoriaId: string, nombre: string, costo: string, codigoBarras?: string) =>
  post<Product>('/catalogo/productos', {
    nombre,
    categoriaId,
    costo,
    ...(codigoBarras === undefined ? {} : { codigoBarras }),
  });

async function sheet(listId: string): Promise<Record<string, string | null>> {
  const response = await request(api.app)
    .get(`/catalogo/listas/${listId}/precios`)
    .set('Authorization', ac);
  expect(response.status).toBe(200);
  expectToMatchContract(response, 'get', '/catalogo/listas/{id}/precios');
  return Object.fromEntries(
    (response.body as PriceSheet).precios.map((row) => [row.nombre, row.precioFinal]),
  );
}

describe('[RF-001] aislamiento del catálogo', () => {
  it('el comercio B no ve las categorías ni los productos del A', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    await createProduct(bebidas.id, 'Agua', '100');

    const visible = await withAppClient(async (client) => {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_B]);
      const counts = await client.query<{ categorias: number; productos: number }>(
        `SELECT (SELECT count(*)::int FROM categoria) AS categorias,
                (SELECT count(*)::int FROM producto) AS productos`,
      );
      await client.query('COMMIT');
      return counts.rows[0];
    });

    expect(visible).toStrictEqual({ categorias: 0, productos: 0 });
  });
});

describe('[RF-029] categorías con tasa de IVA', () => {
  it('el AC crea "Bebidas 21%" y "Libros 0%"', async () => {
    const created = await request(api.app)
      .post('/catalogo/categorias')
      .set('Authorization', ac)
      .send({ nombre: 'Bebidas', tasaIva: '21' });
    await createCategory('Libros', '0');

    expect(created.status).toBe(201);
    expectToMatchContract(created, 'post', '/catalogo/categorias');
    const list = await request(api.app).get('/catalogo/categorias').set('Authorization', ac);
    expectToMatchContract(list, 'get', '/catalogo/categorias');
    expect(
      (list.body as Category[]).map((c) => ({ nombre: c.nombre, tasaIva: c.tasaIva })),
    ).toStrictEqual([
      { nombre: 'Bebidas', tasaIva: '21.0000' },
      { nombre: 'Libros', tasaIva: '0.0000' },
    ]);
  });

  it('una categoría con productos activos no se da de baja', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    await createProduct(bebidas.id, 'Agua', '100');

    const response = await request(api.app)
      .post(`/catalogo/categorias/${bebidas.id}/baja`)
      .set('Authorization', ac);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'CATEGORIA_CON_PRODUCTOS' });
  });
});

describe('[RF-130] [RF-159] productos con imagen', () => {
  it('el AC crea un producto, le carga una imagen y la imagen se puede descargar', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    const created = await request(api.app)
      .post('/catalogo/productos')
      .set('Authorization', ac)
      .send({
        nombre: 'Agua 500 ml',
        categoriaId: bebidas.id,
        costo: '350.50',
        codigoBarras: '7790001',
      });
    expect(created.status).toBe(201);
    expectToMatchContract(created, 'post', '/catalogo/productos');
    const product = created.body as Product;

    const upload = await request(api.app)
      .put(`/catalogo/productos/${product.id}/imagen`)
      .set('Authorization', ac)
      .set('Content-Type', 'image/png')
      .send(PNG);
    const download = await request(api.app)
      .get(`/catalogo/productos/${product.id}/imagen`)
      .set('Authorization', ac)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          callback(null, Buffer.concat(chunks));
        });
      });

    expect(upload.status).toBe(204);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(download.body as Buffer, PNG)).toBe(0);
    const list = await request(api.app).get('/catalogo/productos').set('Authorization', ac);
    expectToMatchContract(list, 'get', '/catalogo/productos');
    expect(list.body).toMatchObject([
      { nombre: 'Agua 500 ml', tieneImagen: true, costo: '350.50' },
    ]);
  });

  it('un archivo que no es una imagen se rechaza aunque declare serlo', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    const product = await createProduct(bebidas.id, 'Agua', '100');

    const fake = await request(api.app)
      .put(`/catalogo/productos/${product.id}/imagen`)
      .set('Authorization', ac)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('<svg onload="alert(1)"/>'));
    const wrongType = await request(api.app)
      .put(`/catalogo/productos/${product.id}/imagen`)
      .set('Authorization', ac)
      .set('Content-Type', 'text/plain')
      .send('hola');

    expect(fake.status).toBe(409);
    expect(fake.body).toMatchObject({ codigo: 'IMAGEN_INVALIDA' });
    expect(wrongType.status).toBe(400);
  });

  it('un producto con reservas no se da de baja', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    const product = await createProduct(bebidas.id, 'Agua', '100');
    reservations = 2;

    const response = await request(api.app)
      .post(`/catalogo/productos/${product.id}/baja`)
      .set('Authorization', ac);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'BAJA_CON_DEPENDENCIAS' });
  });
});

describe('[RF-131] código de barras único entre los activos', () => {
  it('repetirlo se rechaza, y reutilizarlo tras la baja del anterior se permite', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    const first = await createProduct(bebidas.id, 'Agua', '100', '7790001');

    const repeated = await request(api.app)
      .post('/catalogo/productos')
      .set('Authorization', ac)
      .send({ nombre: 'Agua bis', categoriaId: bebidas.id, costo: '100', codigoBarras: '7790001' });
    expect(repeated.status).toBe(409);
    expect(repeated.body).toMatchObject({ codigo: 'CODIGO_BARRAS_EN_USO' });

    await request(api.app).post(`/catalogo/productos/${first.id}/baja`).set('Authorization', ac);
    const reused = await createProduct(bebidas.id, 'Agua nueva', '120', '7790001');

    expect(reused.codigoBarras).toBe('7790001');
  });

  it('cambiar el código de un producto a uno en uso también se rechaza', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    await createProduct(bebidas.id, 'Agua', '100', '7790001');
    const soda = await createProduct(bebidas.id, 'Soda', '100', '7790002');

    const response = await request(api.app)
      .patch(`/catalogo/productos/${soda.id}`)
      .set('Authorization', ac)
      .send({ codigoBarras: '7790001' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'CODIGO_BARRAS_EN_USO' });
  });
});

describe('[RF-028] listas de precios', () => {
  it('al crear una lista "costo + 40%", cada producto tiene su precio calculado', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    const libros = await createCategory('Libros', '0');
    await createProduct(bebidas.id, 'Agua', '100.00');
    await createProduct(libros.id, 'Novela', '1000.00');

    const created = await request(api.app)
      .post('/catalogo/listas')
      .set('Authorization', ac)
      .send({ nombre: 'Minorista', regla: { tipo: 'porcentaje_costo', porcentaje: '40' } });

    expect(created.status).toBe(201);
    expectToMatchContract(created, 'post', '/catalogo/listas');
    // 100 × 1,40 × 1,21 = 169,40; 1000 × 1,40 × 1,00 = 1400,00.
    expect(await sheet((created.body as PriceList).id)).toStrictEqual({
      Agua: '169.40',
      Novela: '1400.00',
    });
  });

  it('la regla por grupo aplica el margen de cada categoría', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    const libros = await createCategory('Libros', '0');
    await createProduct(bebidas.id, 'Agua', '100.00');
    await createProduct(libros.id, 'Novela', '100.00');

    const list = await post<PriceList>('/catalogo/listas', {
      nombre: 'Mayorista',
      regla: { tipo: 'por_grupo', porcentaje: '20', porCategoria: { [bebidas.id]: '35' } },
    });

    expect(await sheet(list.id)).toStrictEqual({ Agua: '163.35', Novela: '120.00' });
  });

  it('un producto nuevo recibe su precio en las listas existentes', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    const list = await post<PriceList>('/catalogo/listas', {
      nombre: 'Minorista',
      regla: { tipo: 'porcentaje_costo', porcentaje: '40' },
    });

    await createProduct(bebidas.id, 'Agua', '100.00');

    expect(await sheet(list.id)).toStrictEqual({ Agua: '169.40' });
  });

  it('cambiar la regla recalcula los precios de la lista', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    await createProduct(bebidas.id, 'Agua', '100.00');
    const list = await post<PriceList>('/catalogo/listas', {
      nombre: 'Minorista',
      regla: { tipo: 'porcentaje_costo', porcentaje: '40' },
    });

    const response = await request(api.app)
      .patch(`/catalogo/listas/${list.id}`)
      .set('Authorization', ac)
      .send({ regla: { tipo: 'porcentaje_costo', porcentaje: '50' } });

    expect(response.status).toBe(200);
    expectToMatchContract(response, 'patch', '/catalogo/listas/{id}');
    // 100 × 1,50 × 1,21 = 181,50.
    expect(await sheet(list.id)).toStrictEqual({ Agua: '181.50' });
  });

  it('en una lista de precio fijo el AC carga el precio, y en una calculada no', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    const agua = await createProduct(bebidas.id, 'Agua', '100.00');
    const fixed = await post<PriceList>('/catalogo/listas', {
      nombre: 'Especial',
      regla: { tipo: 'fijo' },
    });
    const computed = await post<PriceList>('/catalogo/listas', {
      nombre: 'Minorista',
      regla: { tipo: 'porcentaje_costo', porcentaje: '40' },
    });
    expect(await sheet(fixed.id)).toStrictEqual({ Agua: null });

    const manual = await request(api.app)
      .put(`/catalogo/listas/${fixed.id}/precios/${agua.id}`)
      .set('Authorization', ac)
      .send({ precio: '250' });
    const rejected = await request(api.app)
      .put(`/catalogo/listas/${computed.id}/precios/${agua.id}`)
      .set('Authorization', ac)
      .send({ precio: '250' });

    expect(manual.status).toBe(204);
    expect(await sheet(fixed.id)).toStrictEqual({ Agua: '250.00' });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({ codigo: 'PRECIO_CALCULADO' });
    // Un cambio de costo no toca el precio cargado a mano.
    await request(api.app)
      .patch(`/catalogo/productos/${agua.id}`)
      .set('Authorization', ac)
      .send({ costo: '200' });
    expect(await sheet(fixed.id)).toStrictEqual({ Agua: '250.00' });
  });
});

describe('[RF-032] recálculo ante un cambio de costo', () => {
  it('cambiar el costo cambia el precio de lista y deja la fila de historial', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    const agua = await createProduct(bebidas.id, 'Agua', '100.00');
    const list = await post<PriceList>('/catalogo/listas', {
      nombre: 'Minorista',
      regla: { tipo: 'porcentaje_costo', porcentaje: '40' },
    });

    const response = await request(api.app)
      .patch(`/catalogo/productos/${agua.id}`)
      .set('Authorization', ac)
      .send({ costo: '200.00' });

    expect(response.status).toBe(200);
    expectToMatchContract(response, 'patch', '/catalogo/productos/{id}');
    expect(await sheet(list.id)).toStrictEqual({ Agua: '338.80' });
    const history = await ownerSelect<{
      precio_anterior: string | null;
      precio_nuevo: string;
      causa: string;
      usuario_id: string;
    }>(
      `SELECT precio_anterior, precio_nuevo, causa, usuario_id FROM historial_precio
        WHERE lista_id = $1 AND producto_id = $2 ORDER BY momento, precio_anterior NULLS FIRST`,
      [list.id, agua.id],
    );
    expect(history).toStrictEqual([
      {
        precio_anterior: null,
        precio_nuevo: '169.40',
        causa: 'alta_lista',
        usuario_id: USERS.ac.id,
      },
      {
        precio_anterior: '169.40',
        precio_nuevo: '338.80',
        causa: 'costo',
        usuario_id: USERS.ac.id,
      },
    ]);
    const audit = await ownerSelect<{ estado_anterior: { cost: string } }>(
      "SELECT estado_anterior FROM auditoria_comercial WHERE accion = 'producto_modificado'",
    );
    expect(audit[0]?.estado_anterior.cost).toBe('100.00');
  });

  it('cambiar el IVA de la categoría también recalcula', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    await createProduct(bebidas.id, 'Agua', '100.00');
    const list = await post<PriceList>('/catalogo/listas', {
      nombre: 'Minorista',
      regla: { tipo: 'porcentaje_costo', porcentaje: '40' },
    });

    await request(api.app)
      .patch(`/catalogo/categorias/${bebidas.id}`)
      .set('Authorization', ac)
      .send({ tasaIva: '10.5' });

    expect(await sheet(list.id)).toStrictEqual({ Agua: '154.70' });
  });
});

describe('[RF-119] lista activa de cada sucursal', () => {
  it('cada sucursal tiene su lista, y asignar otra reemplaza la anterior', async () => {
    const minorista = await post<PriceList>('/catalogo/listas', {
      nombre: 'Minorista',
      regla: { tipo: 'porcentaje_costo', porcentaje: '40' },
    });
    const mayorista = await post<PriceList>('/catalogo/listas', {
      nombre: 'Mayorista',
      regla: { tipo: 'porcentaje_costo', porcentaje: '20' },
    });

    const assign = (branch: string, listaId: string) =>
      request(api.app)
        .put(`/catalogo/sucursales/${branch}/lista`)
        .set('Authorization', ac)
        .send({ listaId });
    const first = await assign(BRANCH_CENTRO, minorista.id);
    await assign(BRANCH_NORTE, mayorista.id);
    await assign(BRANCH_CENTRO, mayorista.id);

    expect(first.status).toBe(200);
    expectToMatchContract(first, 'put', '/catalogo/sucursales/{id}/lista');
    const branches = await request(api.app).get('/catalogo/sucursales').set('Authorization', ac);
    expectToMatchContract(branches, 'get', '/catalogo/sucursales');
    expect((branches.body as BranchPriceList[]).map((b) => [b.nombre, b.listaId])).toStrictEqual([
      ['Centro', mayorista.id],
      ['Norte', mayorista.id],
    ]);
    // La lista asignada no se puede dar de baja; la que quedó libre sí.
    const assigned = await request(api.app)
      .post(`/catalogo/listas/${mayorista.id}/baja`)
      .set('Authorization', ac);
    const free = await request(api.app)
      .post(`/catalogo/listas/${minorista.id}/baja`)
      .set('Authorization', ac);
    expect(assigned.status).toBe(409);
    expect(assigned.body).toMatchObject({ codigo: 'LISTA_ASIGNADA' });
    expect(free.status).toBe(204);
    // Una lista dada de baja no se puede asignar.
    const inactive = await assign(BRANCH_NORTE, minorista.id);
    expect(inactive.status).toBe(409);
    expect(inactive.body).toMatchObject({ codigo: 'LISTA_INVALIDA' });
  });
});

describe('[RF-049] [RF-149] combos', () => {
  it('se crea un combo de dos productos con su precio único en cada lista', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    const cafe = await createProduct(bebidas.id, 'Café', '300');
    const medialuna = await createProduct(bebidas.id, 'Medialuna', '150');
    const list = await post<PriceList>('/catalogo/listas', {
      nombre: 'Minorista',
      regla: { tipo: 'porcentaje_costo', porcentaje: '40' },
    });

    const created = await request(api.app)
      .post('/catalogo/combos')
      .set('Authorization', ac)
      .send({
        nombre: 'Desayuno',
        precio: '900',
        componentes: [
          { productoId: cafe.id, cantidad: '1' },
          { productoId: medialuna.id, cantidad: '2' },
        ],
      });

    expect(created.status).toBe(201);
    expectToMatchContract(created, 'post', '/catalogo/combos');
    expect(created.body).toMatchObject({
      tipo: 'combo',
      precioCombo: '900.00',
      disponible: true,
      componentes: [
        { nombre: 'Café', cantidad: '1.000', activo: true },
        { nombre: 'Medialuna', cantidad: '2.000', activo: true },
      ],
    });
    expect((await sheet(list.id)).Desayuno).toBe('900.00');
  });

  it('un combo no se puede usar como componente', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    const cafe = await createProduct(bebidas.id, 'Café', '300');
    const combo = await post<Combo>('/catalogo/combos', {
      nombre: 'Café solo',
      precio: '500',
      componentes: [{ productoId: cafe.id, cantidad: '1' }],
    });

    const response = await request(api.app)
      .post('/catalogo/combos')
      .set('Authorization', ac)
      .send({
        nombre: 'Doble combo',
        precio: '900',
        componentes: [{ productoId: combo.id, cantidad: '2' }],
      });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'COMBO_COMO_COMPONENTE' });
  });

  it('al dar de baja un componente, el combo deja de poder venderse', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    const cafe = await createProduct(bebidas.id, 'Café', '300');
    const medialuna = await createProduct(bebidas.id, 'Medialuna', '150');
    const combo = await post<Combo>('/catalogo/combos', {
      nombre: 'Desayuno',
      precio: '900',
      componentes: [
        { productoId: cafe.id, cantidad: '1' },
        { productoId: medialuna.id, cantidad: '2' },
      ],
    });

    await request(api.app)
      .post(`/catalogo/productos/${medialuna.id}/baja`)
      .set('Authorization', ac);

    const combos = await request(api.app).get('/catalogo/combos').set('Authorization', ac);
    expectToMatchContract(combos, 'get', '/catalogo/combos');
    expect(combos.body).toMatchObject([
      { id: combo.id, activo: true, disponible: false, componentes: [{}, { activo: false }] },
    ]);
    const products = await request(api.app).get('/catalogo/productos').set('Authorization', ac);
    expect((products.body as Product[]).find((p) => p.id === combo.id)?.disponible).toBe(false);
  });

  it('cambiar el precio del combo lo cambia en las listas', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    const cafe = await createProduct(bebidas.id, 'Café', '300');
    const list = await post<PriceList>('/catalogo/listas', {
      nombre: 'Minorista',
      regla: { tipo: 'porcentaje_costo', porcentaje: '40' },
    });
    const combo = await post<Combo>('/catalogo/combos', {
      nombre: 'Café solo',
      precio: '500',
      componentes: [{ productoId: cafe.id, cantidad: '1' }],
    });

    const response = await request(api.app)
      .patch(`/catalogo/combos/${combo.id}`)
      .set('Authorization', ac)
      .send({ precio: '550' });

    expect(response.status).toBe(200);
    expectToMatchContract(response, 'patch', '/catalogo/combos/{id}');
    expect((await sheet(list.id))['Café solo']).toBe('550.00');
  });
});

describe('[RF-004] permisos del catálogo', () => {
  it('un AS no puede modificar precios ni el catálogo', async () => {
    const bebidas = await createCategory('Bebidas', '21');
    const agua = await createProduct(bebidas.id, 'Agua', '100');
    const as = await signIn(api.app, USERS.asNorte.email);

    const cost = await request(api.app)
      .patch(`/catalogo/productos/${agua.id}`)
      .set('Authorization', as.authorization)
      .send({ costo: '1' });
    const list = await request(api.app)
      .post('/catalogo/listas')
      .set('Authorization', as.authorization)
      .send({ nombre: 'Trampa', regla: { tipo: 'fijo' } });

    expect(cost.status).toBe(403);
    expect(list.status).toBe(403);
  });
});
