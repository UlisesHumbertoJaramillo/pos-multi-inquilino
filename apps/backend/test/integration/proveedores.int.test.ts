// Proveedores, importación de catálogo, compras, recepción y pagos (T-104 a T-109).
import type { CatalogImportResult, Purchase, Supplier, SupplierStatement } from '@pos/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerQuery, ownerSelect } from '../support/database.js';
import {
  BRANCH_CENTRO,
  seedIdentity,
  signIn,
  TENANT_A,
  USERS,
} from '../support/identity-fixtures.js';

const api = createTestApi();
afterAll(() => api.close());

const BEBIDAS = 'a4000000-0000-4000-8000-000000000001';
const AGUA = 'a5000000-0000-4000-8000-000000000001';
const GASEOSA = 'a5000000-0000-4000-8000-000000000002';
const LIST = 'a6000000-0000-4000-8000-000000000001';

let ac: string;
let asCentro: string;
let asNorte: string;

beforeEach(async () => {
  await seedIdentity();
  await ownerQuery(
    `INSERT INTO categoria (id, tenant_id, nombre, tasa_iva, creado_en)
     VALUES ($1, $2, 'Bebidas', 21, now())`,
    [BEBIDAS, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO producto (id, tenant_id, tipo, nombre, codigo_barras, categoria_id, costo, creado_en)
     VALUES ($1, $3, 'simple', 'Agua', '7790001', $4, 100, now()),
            ($2, $3, 'simple', 'Gaseosa', '7790002', $4, 200, now())`,
    [AGUA, GASEOSA, TENANT_A, BEBIDAS],
  );
  // Lista "costo + 40 % + IVA": Agua a 100 → 169,40.
  await ownerQuery(
    `INSERT INTO lista_precio (id, tenant_id, nombre, regla, parametros, creado_en)
     VALUES ($1, $2, 'Minorista', 'porcentaje_costo', '{"porcentaje": "40"}', now())`,
    [LIST, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO precio_lista (id, tenant_id, lista_id, producto_id, precio_final, calculado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, 169.40, now()),
            (gen_random_uuid(), $1, $2, $4, 338.80, now())`,
    [TENANT_A, LIST, AGUA, GASEOSA],
  );
  ac = (await signIn(api.app, USERS.ac.email)).authorization;
  asCentro = (await signIn(api.app, USERS.asVo.email, 'AS')).authorization;
  asNorte = (await signIn(api.app, USERS.asNorte.email, 'AS')).authorization;
});

async function send<T>(
  auth: string,
  method: 'get' | 'post' | 'patch',
  path: string,
  body?: object,
  expected = 200,
): Promise<T> {
  api.clock.advance(1000);
  const response = await request(api.app)[method](path).set('Authorization', auth).send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(expected);
  return response.body as T;
}

const createSupplier = (razonSocial = 'Distribuidora Sur', cuit: string | null = '30712345671') =>
  send<Supplier>(
    ac,
    'post',
    '/proveedores',
    { razonSocial, cuit, contacto: 'ventas@sur.local' },
    201,
  );

const price = async (productId: string) =>
  (
    await ownerSelect<{ precio_final: string }>(
      'SELECT precio_final FROM precio_lista WHERE producto_id = $1',
      [productId],
    )
  )[0]?.precio_final;

const buy = (proveedorId: string, items: object[], expected = 201) =>
  send<Purchase>(
    ac,
    'post',
    '/compras',
    { proveedorId, sucursalId: BRANCH_CENTRO, comprobante: 'FC A 0001-00001234', items },
    expected,
  );

describe('[RF-034] proveedores', () => {
  it('el AC crea y modifica un proveedor', async () => {
    const response = await request(api.app)
      .post('/proveedores')
      .set('Authorization', ac)
      .send({ razonSocial: 'Distribuidora Sur', cuit: '30-71234567-1' });
    expect(response.status).toBe(201);
    expectToMatchContract(response, 'post', '/proveedores');
    expect(response.body).toMatchObject({ cuit: '30712345671', saldoAdeudado: '0.00' });

    const id = (response.body as Supplier).id;
    const updated = await send<Supplier>(ac, 'patch', `/proveedores/${id}`, {
      contacto: 'Juana, 11-5555-0000',
    });
    expect(updated.contacto).toBe('Juana, 11-5555-0000');
    const list = await request(api.app).get('/proveedores').set('Authorization', ac);
    expectToMatchContract(list, 'get', '/proveedores');
  });

  it.each([
    ['30712345672', 'CUIT_INVALIDO'],
    ['123', 'CUIT_INVALIDO'],
  ])('rechaza el CUIT %s', async (cuit, codigo) => {
    const response = await request(api.app)
      .post('/proveedores')
      .set('Authorization', ac)
      .send({ razonSocial: 'Otro', cuit });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo });
  });

  it('no repite el CUIT entre proveedores activos', async () => {
    await createSupplier();
    const response = await request(api.app)
      .post('/proveedores')
      .set('Authorization', ac)
      .send({ razonSocial: 'Copia', cuit: '30712345671' });
    expect(response.body).toMatchObject({ codigo: 'CUIT_EN_USO' });
  });

  it('[RF-004] el AS no gestiona proveedores', async () => {
    const response = await request(api.app).get('/proveedores').set('Authorization', asCentro);
    expect(response.status).toBe(403);
  });
});

describe('[RF-035] importación de catálogo', () => {
  const upload = (supplierId: string, csv: string, type = 'text/csv') =>
    request(api.app)
      .post(`/proveedores/${supplierId}/importaciones`)
      .set('Authorization', ac)
      .set('Content-Type', type)
      .send(Buffer.from(csv, 'utf8'));

  it('un CSV con 2 filas inválidas importa el resto y devuelve las 2 con su motivo', async () => {
    const supplier = await createSupplier();
    const csv = [
      'codigo_barras,nombre,costo,categoria',
      '7790001,Agua mineral 500 ml,150,Bebidas',
      '7790009,Jugo de naranja,300.50,bebidas',
      '7790010,Soda,abc,Bebidas',
      '7790011,"Vino tinto, 750 ml",900,Vinos',
    ].join('\n');

    const response = await upload(supplier.id, csv);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expectToMatchContract(response, 'post', '/proveedores/{id}/importaciones');
    const result = response.body as CatalogImportResult;
    expect(result).toMatchObject({ filasOk: 2, creados: 1, actualizados: 1 });
    expect(result.errores).toStrictEqual([
      { fila: 4, codigoBarras: '7790010', motivo: expect.stringContaining('costo') as string },
      {
        fila: 5,
        codigoBarras: '7790011',
        motivo: 'La categoría «Vinos» no existe o está dada de baja.',
      },
    ]);
    // Agua: costo 150 → 150 × 1,40 × 1,21 = 254,10. El jugo nuevo entra a la lista.
    expect(await price(AGUA)).toBe('254.10');
    expect(
      await ownerSelect('SELECT nombre, costo FROM producto WHERE codigo_barras = $1', ['7790009']),
    ).toStrictEqual([{ nombre: 'Jugo de naranja', costo: '300.50' }]);
    // Una sola entrada de auditoría con el detalle, incluido el recálculo.
    const audit = await ownerSelect<{ estado_posterior: Record<string, unknown> }>(
      "SELECT estado_posterior FROM auditoria_comercial WHERE accion = 'catalogo_importado'",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.estado_posterior).toMatchObject({
      filasOk: 2,
      preciosRecalculados: 2,
      errores: [{ line: 4 }, { line: 5 }],
    });
    expect(await ownerSelect('SELECT filas_ok, creados FROM importacion_catalogo')).toStrictEqual([
      { filas_ok: 2, creados: 1 },
    ]);
  });

  it('acepta punto y coma con coma decimal, como lo guarda Excel', async () => {
    const supplier = await createSupplier();
    const csv =
      'Código de barras;Nombre;Costo;Categoría\r\n7790002;Gaseosa cola;1.250,50;Bebidas\r\n';

    const response = await upload(supplier.id, csv, 'application/vnd.ms-excel');

    expect(response.body).toMatchObject({ filasOk: 1, actualizados: 1, errores: [] });
    expect(await ownerSelect('SELECT costo FROM producto WHERE id = $1', [GASEOSA])).toStrictEqual([
      { costo: '1250.50' },
    ]);
  });

  it('un archivo sin las columnas se rechaza entero', async () => {
    const supplier = await createSupplier();

    const response = await upload(supplier.id, 'codigo,precio\n1,2');

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'CSV_INVALIDO' });
  });
});

describe('[RF-036] compras a crédito', () => {
  it('la deuda sube, el costo se actualiza y el precio se recalcula', async () => {
    const supplier = await createSupplier();

    const response = await request(api.app)
      .post('/compras')
      .set('Authorization', ac)
      .send({
        proveedorId: supplier.id,
        sucursalId: BRANCH_CENTRO,
        items: [
          { productoId: AGUA, cantidad: '12', costoUnitario: '150' },
          { productoId: GASEOSA, cantidad: '2.5', costoUnitario: '199.99' },
        ],
      });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expectToMatchContract(response, 'post', '/compras');
    // 12 × 150 = 1800,00; 2,5 × 199,99 = 499,975 → 499,98. Total 2299,98.
    expect(response.body).toMatchObject({ estado: 'pendiente', total: '2299.98' });
    const account = await send<SupplierStatement>(ac, 'get', `/proveedores/${supplier.id}/cuenta`);
    expect(account.proveedor.saldoAdeudado).toBe('2299.98');
    expect(await price(AGUA)).toBe('254.10');
    expect(
      await ownerSelect(
        "SELECT causa FROM historial_precio WHERE producto_id = $1 AND causa = 'costo'",
        [AGUA],
      ),
    ).toHaveLength(1);
  });

  it('[RF-148] un producto con una compra pendiente no se da de baja', async () => {
    const supplier = await createSupplier();
    await buy(supplier.id, [{ productoId: AGUA, cantidad: '1', costoUnitario: '100' }]);

    const response = await request(api.app)
      .post(`/catalogo/productos/${AGUA}/baja`)
      .set('Authorization', ac);

    expect(response.status).toBe(409);
    expect((response.body as { mensaje: string }).mensaje).toContain('1 compra(s) pendiente(s)');
  });
});

describe('[RF-133] recepción de compras', () => {
  let purchase: Purchase;
  let supplier: Supplier;

  beforeEach(async () => {
    supplier = await createSupplier();
    purchase = await buy(supplier.id, [
      { productoId: AGUA, cantidad: '12', costoUnitario: '100' },
      { productoId: GASEOSA, cantidad: '6', costoUnitario: '200' },
    ]);
  });

  const receive = (items: object[], auth = asCentro, expected = 200) =>
    send<Purchase>(auth, 'post', `/compras/${purchase.id}/recepcion`, { items }, expected);

  it('el stock sube con lo recibido y la diferencia queda registrada, sin cambiar la deuda', async () => {
    const pending = await request(api.app).get('/recepciones').set('Authorization', asCentro);
    expectToMatchContract(pending, 'get', '/recepciones');
    expect((pending.body as Purchase[]).map((p) => p.id)).toStrictEqual([purchase.id]);

    const response = await request(api.app)
      .post(`/compras/${purchase.id}/recepcion`)
      .set('Authorization', asCentro)
      .send({
        items: [
          { productoId: AGUA, recibida: '10' },
          { productoId: GASEOSA, recibida: '6' },
        ],
      });

    expectToMatchContract(response, 'post', '/compras/{id}/recepcion');
    expect(response.body).toMatchObject({ estado: 'recibida' });
    expect(
      (response.body as Purchase).items.map((i) => [i.nombre, i.recibida, i.diferencia]),
    ).toStrictEqual([
      ['Agua', '10.000', '2.000'],
      ['Gaseosa', '6.000', '0.000'],
    ]);
    expect(
      await ownerSelect(
        'SELECT producto_id, disponible FROM inventario WHERE sucursal_id = $1 ORDER BY disponible',
        [BRANCH_CENTRO],
      ),
    ).toStrictEqual([
      { producto_id: GASEOSA, disponible: '6.000' },
      { producto_id: AGUA, disponible: '10.000' },
    ]);
    expect(
      await ownerSelect('SELECT tipo, referencia FROM movimiento_stock WHERE producto_id = $1', [
        AGUA,
      ]),
    ).toStrictEqual([{ tipo: 'ingreso', referencia: purchase.id }]);
    const account = await send<SupplierStatement>(ac, 'get', `/proveedores/${supplier.id}/cuenta`);
    expect(account.proveedor.saldoAdeudado).toBe('2400.00');
  });

  it('no se recibe más de lo comprado ni dos veces', async () => {
    await receive([{ productoId: AGUA, recibida: '13' }], asCentro, 409);
    expect(await ownerSelect('SELECT id FROM inventario')).toStrictEqual([]);

    await receive([{ productoId: AGUA, recibida: '12' }]);
    const again = await request(api.app)
      .post(`/compras/${purchase.id}/recepcion`)
      .set('Authorization', asCentro)
      .send({ items: [] });
    expect(again.body).toMatchObject({ codigo: 'COMPRA_RECIBIDA' });
  });

  it('[RF-004] solo la recibe un AS de la sucursal de destino', async () => {
    await receive([{ productoId: AGUA, recibida: '12' }], asNorte, 403);
    await receive([{ productoId: AGUA, recibida: '12' }], ac, 403);
  });
});

describe('[RF-037] [RF-038] pagos a proveedores', () => {
  it('un pago baja la deuda; uno de más exige confirmación', async () => {
    const supplier = await createSupplier();
    await buy(supplier.id, [{ productoId: AGUA, cantidad: '10', costoUnitario: '100' }]);

    api.clock.advance(1000);
    const response = await request(api.app)
      .post(`/proveedores/${supplier.id}/pagos`)
      .set('Authorization', ac)
      .send({ monto: '400', metodo: 'transferencia', comprobante: 'TRF 998877' });
    expect(response.status).toBe(201);
    expectToMatchContract(response, 'post', '/proveedores/{id}/pagos');
    expect(response.body).toMatchObject({ saldoAdeudado: '600.00' });

    const excess = await request(api.app)
      .post(`/proveedores/${supplier.id}/pagos`)
      .set('Authorization', ac)
      .send({ monto: '700', metodo: 'efectivo', comprobante: 'Recibo 12' });
    expect(excess.status).toBe(409);
    expect(excess.body).toMatchObject({ codigo: 'PAGO_EXCEDE_DEUDA' });

    const confirmed = await send<{ saldoAdeudado: string; pago: { confirmadoExceso: boolean } }>(
      ac,
      'post',
      `/proveedores/${supplier.id}/pagos`,
      { monto: '700', metodo: 'efectivo', comprobante: 'Recibo 12', confirmarExceso: true },
      201,
    );
    expect(confirmed).toMatchObject({ saldoAdeudado: '-100.00', pago: { confirmadoExceso: true } });
    const account = await request(api.app)
      .get(`/proveedores/${supplier.id}/cuenta`)
      .set('Authorization', ac);
    expectToMatchContract(account, 'get', '/proveedores/{id}/cuenta');
    expect((account.body as SupplierStatement).movimientos.map((m) => m.tipo)).toStrictEqual([
      'pago',
      'pago',
      'compra',
    ]);
  });

  it('[RF-148] un proveedor con saldo no se da de baja', async () => {
    const supplier = await createSupplier();
    await buy(supplier.id, [{ productoId: AGUA, cantidad: '1', costoUnitario: '100' }]);

    await send(ac, 'post', `/proveedores/${supplier.id}/baja`, {}, 409);
    await send(
      ac,
      'post',
      `/proveedores/${supplier.id}/pagos`,
      { monto: '100', metodo: 'cheque', comprobante: 'Cheque 5' },
      201,
    );
    await send(ac, 'post', `/proveedores/${supplier.id}/baja`, {}, 204);
  });
});
