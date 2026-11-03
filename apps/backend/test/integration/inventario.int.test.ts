// Inventario: saldos, operaciones atómicas, ajustes, mermas, alertas, revisión, combos y
// transferencias (T-088 a T-097).
import type { Alert, ComboStock, StockBalance, StockRow, Transfer } from '@pos/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { OperationName } from '../../src/modulos/inventario/dominio/stock.js';
import { createTestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerQuery, ownerSelect } from '../support/database.js';
import {
  BRANCH_B,
  BRANCH_CENTRO,
  BRANCH_NORTE,
  seedIdentity,
  signIn,
  TENANT_A,
  USERS,
} from '../support/identity-fixtures.js';

const api = createTestApi();
afterAll(() => api.close());

const CATEGORY = 'a4000000-0000-4000-8000-000000000001';
const LECHE = 'a5000000-0000-4000-8000-000000000001';
const GALLETITAS = 'a5000000-0000-4000-8000-000000000002';
const COMBO = 'a5000000-0000-4000-8000-000000000003';

// AS de Centro y de Norte; AS solo de Norte; AC del comercio.
let asBoth: string;
let asNorte: string;
let ac: string;

beforeEach(async () => {
  await seedIdentity();
  await ownerQuery(
    `INSERT INTO categoria (id, tenant_id, nombre, tasa_iva, creado_en)
     VALUES ($1, $2, 'Lácteos', 10.5, now())`,
    [CATEGORY, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO producto (id, tenant_id, tipo, nombre, categoria_id, costo, creado_en) VALUES
       ($1, $3, 'simple', 'Leche', $4, 100, now()),
       ($2, $3, 'simple', 'Galletitas', $4, 50, now())`,
    [LECHE, GALLETITAS, TENANT_A, CATEGORY],
  );
  await ownerQuery(
    `INSERT INTO producto (id, tenant_id, tipo, nombre, precio_combo, creado_en)
     VALUES ($1, $2, 'combo', 'Combo merienda', 500, now())`,
    [COMBO, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO combo_componente (id, tenant_id, combo_id, producto_id, cantidad, creado_en) VALUES
       (gen_random_uuid(), $1, $2, $3, 1, now()),
       (gen_random_uuid(), $1, $2, $4, 2, now())`,
    [TENANT_A, COMBO, LECHE, GALLETITAS],
  );
  asBoth = (await signIn(api.app, USERS.asVo.email, 'AS')).authorization;
  asNorte = (await signIn(api.app, USERS.asNorte.email, 'AS')).authorization;
  ac = (await signIn(api.app, USERS.ac.email)).authorization;
});

// Cada operación un segundo después de la anterior: los movimientos quedan en orden.
const actor = () => {
  api.clock.advance(1000);
  return { tenantId: TENANT_A, userId: USERS.asVo.id, at: api.clock.now() };
};

// Operación directa sobre el servicio de inventario, como la usarán ventas y devoluciones.
function operate(branchId: string, productId: string, operation: OperationName, quantity: string) {
  return api.db.run(
    () =>
      api.inventory.ledger.apply(actor(), {
        branchId,
        product: { id: productId, name: productId === LECHE ? 'Leche' : 'Galletitas' },
        operation,
        quantity,
      }),
    { tenantId: TENANT_A },
  );
}

async function send<T>(
  auth: string,
  method: 'get' | 'post' | 'put',
  path: string,
  body?: object,
  expected = 200,
): Promise<T> {
  api.clock.advance(1000);
  const response = await request(api.app)[method](path).set('Authorization', auth).send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(expected);
  return response.body as T;
}

const adjust = (branchId: string, productoId: string, cantidad: string, auth = asBoth) =>
  send<StockBalance>(auth, 'post', `/inventario/sucursales/${branchId}/ajustes`, {
    productoId,
    cantidad,
    motivo: 'Conteo inicial',
  });

async function stockOf(branchId: string, productId: string): Promise<StockRow> {
  const rows = await send<StockRow[]>(asBoth, 'get', `/inventario/sucursales/${branchId}/stock`);
  const row = rows.find((r) => r.productoId === productId);
  if (!row) throw new Error('No está el producto en el stock.');
  return row;
}

const movements = () =>
  ownerSelect<{ tipo: string; estado_origen: string | null; estado_destino: string | null }>(
    'SELECT tipo, estado_origen, estado_destino FROM movimiento_stock ORDER BY momento, id',
  );

describe('[RF-039] saldos en cuatro estados', () => {
  it('la base rechaza un saldo negativo', async () => {
    await operate(BRANCH_CENTRO, LECHE, 'ingresar', '1');

    await expect(
      ownerQuery('UPDATE inventario SET disponible = disponible - 2 WHERE producto_id = $1', [
        LECHE,
      ]),
    ).rejects.toThrow(/inventario_disponible_check/);
  });

  it('cada operación mueve el saldo entre estados y deja su movimiento', async () => {
    await operate(BRANCH_CENTRO, LECHE, 'ingresar', '10');
    await operate(BRANCH_CENTRO, LECHE, 'reservar', '4');
    await operate(BRANCH_CENTRO, LECHE, 'liberar', '1');
    await operate(BRANCH_CENTRO, LECHE, 'consumir', '2');
    await operate(BRANCH_CENTRO, LECHE, 'pasarARevision', '3');
    const last = await operate(BRANCH_CENTRO, LECHE, 'pasarATransito', '2.5');

    expect(last).toMatchObject({
      available: '4.500',
      reserved: '1.000',
      inReview: '3.000',
      inTransit: '2.500',
    });
    expect(await movements()).toStrictEqual([
      { tipo: 'ingreso', estado_origen: null, estado_destino: 'disponible' },
      { tipo: 'reserva', estado_origen: 'disponible', estado_destino: 'reservado' },
      { tipo: 'liberacion', estado_origen: 'reservado', estado_destino: 'disponible' },
      { tipo: 'venta', estado_origen: 'reservado', estado_destino: null },
      { tipo: 'devolucion', estado_origen: null, estado_destino: 'en_revision' },
      { tipo: 'transferencia', estado_origen: 'disponible', estado_destino: 'en_transito' },
    ]);
  });

  it('[RF-057] reservar más de lo disponible no modifica ninguna fila', async () => {
    await operate(BRANCH_CENTRO, LECHE, 'ingresar', '2');

    await expect(operate(BRANCH_CENTRO, LECHE, 'reservar', '3')).rejects.toMatchObject({
      code: 'STOCK_INSUFICIENTE',
    });
    await expect(operate(BRANCH_NORTE, LECHE, 'reservar', '1')).rejects.toMatchObject({
      code: 'STOCK_INSUFICIENTE',
    });
    expect(
      await ownerSelect('SELECT disponible, reservado, version FROM inventario'),
    ).toStrictEqual([{ disponible: '2.000', reservado: '0.000', version: 0 }]);
    expect(await movements()).toHaveLength(1);
  });
});

describe('[RF-040] [RF-043] ajustes del AS', () => {
  it('el AS ajusta el stock de su sucursal y no puede dejarlo negativo', async () => {
    const response = await request(api.app)
      .post(`/inventario/sucursales/${BRANCH_CENTRO}/ajustes`)
      .set('Authorization', asBoth)
      .send({ productoId: LECHE, cantidad: '10', motivo: 'Conteo inicial' });
    expectToMatchContract(response, 'post', '/inventario/sucursales/{id}/ajustes');
    expect(response.body).toMatchObject({ disponible: '10.000' });

    const rejected = await request(api.app)
      .post(`/inventario/sucursales/${BRANCH_CENTRO}/ajustes`)
      .set('Authorization', asBoth)
      .send({ productoId: LECHE, cantidad: '-10.5', motivo: 'Rotura no informada' });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({ codigo: 'STOCK_INSUFICIENTE' });

    const list = await request(api.app)
      .get(`/inventario/sucursales/${BRANCH_CENTRO}/stock`)
      .set('Authorization', asBoth);
    expectToMatchContract(list, 'get', '/inventario/sucursales/{id}/stock');
    expect((list.body as StockRow[]).map((r) => [r.nombre, r.disponible])).toStrictEqual([
      ['Galletitas', '0.000'],
      ['Leche', '10.000'],
    ]);
    expect(
      await ownerSelect(
        "SELECT accion, sucursal_id FROM auditoria_comercial WHERE entidad = 'inventario'",
      ),
    ).toStrictEqual([{ accion: 'stock_ajuste', sucursal_id: BRANCH_CENTRO }]);
  });

  it('[RF-004] el AS de una sucursal no ajusta el stock de otra', async () => {
    const response = await request(api.app)
      .post(`/inventario/sucursales/${BRANCH_CENTRO}/ajustes`)
      .set('Authorization', asNorte)
      .send({ productoId: LECHE, cantidad: '1', motivo: 'Intento ajeno' });

    expect(response.status).toBe(403);
  });

  it('un combo no tiene stock propio', async () => {
    const response = await request(api.app)
      .post(`/inventario/sucursales/${BRANCH_CENTRO}/ajustes`)
      .set('Authorization', asBoth)
      .send({ productoId: COMBO, cantidad: '1', motivo: 'Conteo inicial' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'ES_UN_COMBO' });
  });
});

describe('[RF-042] mermas', () => {
  it('la merma descuenta stock y deja su movimiento con motivo, sin mover dinero', async () => {
    await adjust(BRANCH_CENTRO, LECHE, '10');

    const balance = await send<StockBalance>(
      asBoth,
      'post',
      `/inventario/sucursales/${BRANCH_CENTRO}/mermas`,
      { productoId: LECHE, cantidad: '3', motivo: 'vencimiento', observacion: 'Lote de octubre' },
    );

    expect(balance.disponible).toBe('7.000');
    // Sale del inventario (sin estado de destino): no es una venta ni genera un ingreso.
    expect(
      await ownerSelect(
        "SELECT estado_destino, cantidad, motivo FROM movimiento_stock WHERE tipo = 'merma'",
      ),
    ).toStrictEqual([
      { estado_destino: null, cantidad: '3.000', motivo: 'vencimiento: Lote de octubre' },
    ]);
  });

  it('[RF-043] una merma mayor que el disponible se rechaza', async () => {
    await adjust(BRANCH_CENTRO, LECHE, '2');

    const response = await request(api.app)
      .post(`/inventario/sucursales/${BRANCH_CENTRO}/mermas`)
      .set('Authorization', asBoth)
      .send({ productoId: LECHE, cantidad: '3', motivo: 'rotura' });

    expect(response.status).toBe(409);
    expect((await stockOf(BRANCH_CENTRO, LECHE)).disponible).toBe('2.000');
  });
});

describe('[RF-041] alerta de stock mínimo', () => {
  const alerts = () =>
    ownerSelect<{ resuelta: boolean }>(
      "SELECT resuelta_en IS NOT NULL AS resuelta FROM alerta WHERE tipo = 'stock_minimo' ORDER BY creada_en, id",
    );
  const waste = (cantidad: string) =>
    send(asBoth, 'post', `/inventario/sucursales/${BRANCH_CENTRO}/mermas`, {
      productoId: LECHE,
      cantidad,
      motivo: 'rotura',
    });

  it('alerta una vez por cruce del umbral y se rearma al reponer', async () => {
    await adjust(BRANCH_CENTRO, LECHE, '10');
    await send(asBoth, 'put', `/inventario/sucursales/${BRANCH_CENTRO}/umbrales/${LECHE}`, {
      umbral: '5',
    });

    await waste('6');
    await waste('1');
    expect(await alerts()).toStrictEqual([{ resuelta: false }]);
    const pending = await request(api.app)
      .get(`/inventario/sucursales/${BRANCH_CENTRO}/alertas`)
      .set('Authorization', asBoth);
    expectToMatchContract(pending, 'get', '/inventario/sucursales/{id}/alertas');
    expect((pending.body as Alert[])[0]).toMatchObject({
      tipo: 'stock_minimo',
      detalle: { producto: 'Leche', disponible: '4.000', umbral: '5.000' },
    });

    await adjust(BRANCH_CENTRO, LECHE, '5');
    expect(await alerts()).toStrictEqual([{ resuelta: true }]);
    expect((await stockOf(BRANCH_CENTRO, LECHE)).alertaActiva).toBe(false);

    await waste('4');
    expect(await alerts()).toStrictEqual([{ resuelta: true }, { resuelta: false }]);
  });

  it('la alerta de stock mínimo no se descarta a mano', async () => {
    await send(asBoth, 'put', `/inventario/sucursales/${BRANCH_CENTRO}/umbrales/${LECHE}`, {
      umbral: '1',
    });
    const [alert] = await send<Alert[]>(
      asBoth,
      'get',
      `/inventario/sucursales/${BRANCH_CENTRO}/alertas`,
    );
    if (!alert) throw new Error('Falta la alerta.');

    const response = await request(api.app)
      .post(`/inventario/sucursales/${BRANCH_CENTRO}/alertas/${alert.id}/descarte`)
      .set('Authorization', asBoth);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'ALERTA_NO_DESCARTABLE' });
  });
});

describe('[RF-088] revisión de ítems "En Revisión"', () => {
  it('el AS reingresa una parte al disponible y pasa otra a merma', async () => {
    await operate(BRANCH_CENTRO, LECHE, 'pasarARevision', '3');

    await send(asBoth, 'post', `/inventario/sucursales/${BRANCH_CENTRO}/revision/${LECHE}`, {
      accion: 'reingresar',
      cantidad: '2',
    });
    const balance = await send<StockBalance>(
      asBoth,
      'post',
      `/inventario/sucursales/${BRANCH_CENTRO}/revision/${LECHE}`,
      { accion: 'merma', cantidad: '1', motivo: 'Envase dañado' },
    );

    expect(balance).toMatchObject({ disponible: '2.000', enRevision: '0.000' });
    expect((await movements()).slice(1)).toStrictEqual([
      { tipo: 'reingreso', estado_origen: 'en_revision', estado_destino: 'disponible' },
      { tipo: 'merma', estado_origen: 'en_revision', estado_destino: null },
    ]);
  });
});

describe('[RF-052] disponibilidad de combos sobre el stock real', () => {
  it('el combo muestra lo que permite su componente más escaso', async () => {
    await adjust(BRANCH_CENTRO, LECHE, '5');
    await adjust(BRANCH_CENTRO, GALLETITAS, '7');

    const response = await request(api.app)
      .get(`/inventario/sucursales/${BRANCH_CENTRO}/combos`)
      .set('Authorization', asBoth);

    expectToMatchContract(response, 'get', '/inventario/sucursales/{id}/combos');
    expect(response.body as ComboStock[]).toStrictEqual([
      { comboId: COMBO, nombre: 'Combo merienda', unidades: 3, vendible: true },
    ]);
  });
});

describe('[RF-044] [RF-047] emisión de transferencias', () => {
  const issue = (destinoId: string, cantidad: string, auth = asBoth, expected = 201) =>
    send<Transfer>(
      auth,
      'post',
      '/inventario/transferencias',
      { origenId: BRANCH_CENTRO, destinoId, items: [{ productoId: LECHE, cantidad }] },
      expected,
    );

  it('el stock pasa del disponible de origen al tránsito', async () => {
    await adjust(BRANCH_CENTRO, LECHE, '10');

    const response = await request(api.app)
      .post('/inventario/transferencias')
      .set('Authorization', asBoth)
      .send({
        origenId: BRANCH_CENTRO,
        destinoId: BRANCH_NORTE,
        items: [{ productoId: LECHE, cantidad: '4' }],
      });

    expect(response.status).toBe(201);
    expectToMatchContract(response, 'post', '/inventario/transferencias');
    expect(response.body).toMatchObject({
      estado: 'enviada',
      origen: { nombre: 'Centro' },
      destino: { nombre: 'Norte' },
      items: [{ nombre: 'Leche', enviada: '4.000', recibida: null }],
    });
    expect(await stockOf(BRANCH_CENTRO, LECHE)).toMatchObject({
      disponible: '6.000',
      enTransito: '4.000',
    });
  });

  it('una transferencia a una sucursal de otro comercio se rechaza', async () => {
    await adjust(BRANCH_CENTRO, LECHE, '10');

    await issue(BRANCH_B, '1', asBoth, 404);
    expect((await stockOf(BRANCH_CENTRO, LECHE)).disponible).toBe('10.000');
  });

  it('no se transfiere más de lo disponible ni desde una sucursal ajena', async () => {
    await adjust(BRANCH_CENTRO, LECHE, '1');

    await issue(BRANCH_NORTE, '2', asBoth, 409);
    await issue(BRANCH_NORTE, '1', asNorte, 403);
    expect(await ownerSelect('SELECT id FROM transferencia')).toStrictEqual([]);
  });
});

describe('[RF-045] [RF-046] [RF-150] [RF-151] recepción, rechazo y cancelación', () => {
  let transfer: Transfer;

  beforeEach(async () => {
    await adjust(BRANCH_CENTRO, LECHE, '10');
    await adjust(BRANCH_CENTRO, GALLETITAS, '10');
    transfer = await send<Transfer>(
      asBoth,
      'post',
      '/inventario/transferencias',
      {
        origenId: BRANCH_CENTRO,
        destinoId: BRANCH_NORTE,
        items: [
          { productoId: LECHE, cantidad: '4' },
          { productoId: GALLETITAS, cantidad: '6' },
        ],
      },
      201,
    );
  });

  const receive = (items: object[], auth = asNorte, expected = 200) =>
    send<Transfer>(
      auth,
      'post',
      `/inventario/transferencias/${transfer.id}/recepcion`,
      { items },
      expected,
    );

  it('recepción completa: lo enviado entra al disponible de destino', async () => {
    const response = await request(api.app)
      .post(`/inventario/transferencias/${transfer.id}/recepcion`)
      .set('Authorization', asNorte)
      .send({
        items: [
          { productoId: LECHE, recibida: '4', rechazada: '0' },
          { productoId: GALLETITAS, recibida: '6', rechazada: '0' },
        ],
      });

    expectToMatchContract(response, 'post', '/inventario/transferencias/{id}/recepcion');
    expect(response.body).toMatchObject({ estado: 'recibida' });
    expect(await stockOf(BRANCH_NORTE, LECHE)).toMatchObject({ disponible: '4.000' });
    expect(await stockOf(BRANCH_CENTRO, LECHE)).toMatchObject({
      disponible: '6.000',
      enTransito: '0.000',
    });
  });

  it('el faltante va a merma por pérdida en tránsito y alerta a los dos AS', async () => {
    const closed = await receive([
      { productoId: LECHE, recibida: '3', rechazada: '0' },
      { productoId: GALLETITAS, recibida: '6', rechazada: '0' },
    ]);

    expect(closed.estado).toBe('parcial');
    expect(closed.items.find((i) => i.productoId === LECHE)).toMatchObject({
      recibida: '3.000',
      faltante: '1.000',
    });
    expect(await stockOf(BRANCH_NORTE, LECHE)).toMatchObject({ disponible: '3.000' });
    expect(await stockOf(BRANCH_CENTRO, LECHE)).toMatchObject({ enTransito: '0.000' });
    expect(
      await ownerSelect(
        "SELECT cantidad, motivo FROM movimiento_stock WHERE tipo = 'merma' AND estado_origen = 'en_transito'",
      ),
    ).toStrictEqual([{ cantidad: '1.000', motivo: 'perdida_en_transito' }]);
    expect(
      await ownerSelect<{ sucursal_id: string }>(
        "SELECT sucursal_id FROM alerta WHERE tipo = 'transferencia_faltante' ORDER BY sucursal_id",
      ),
    ).toStrictEqual([{ sucursal_id: BRANCH_CENTRO }, { sucursal_id: BRANCH_NORTE }]);
  });

  it('no se acepta recibir más de lo enviado', async () => {
    await receive([{ productoId: LECHE, recibida: '5', rechazada: '0' }], asNorte, 409);

    expect(await stockOf(BRANCH_CENTRO, LECHE)).toMatchObject({ enTransito: '4.000' });
    expect(
      (await ownerSelect<{ estado: string }>('SELECT estado FROM transferencia'))[0]?.estado,
    ).toBe('enviada');
  });

  it('un rechazo parcial devuelve lo rechazado al disponible de origen', async () => {
    const closed = await receive([
      { productoId: LECHE, recibida: '4', rechazada: '0' },
      { productoId: GALLETITAS, recibida: '2', rechazada: '4' },
    ]);

    expect(closed.estado).toBe('parcial');
    expect(await stockOf(BRANCH_CENTRO, GALLETITAS)).toMatchObject({
      disponible: '8.000',
      enTransito: '0.000',
    });
    expect(await stockOf(BRANCH_NORTE, GALLETITAS)).toMatchObject({ disponible: '2.000' });
  });

  it('el rechazo total devuelve todo al origen', async () => {
    const closed = await send<Transfer>(
      asNorte,
      'post',
      `/inventario/transferencias/${transfer.id}/rechazo`,
    );

    expect(closed.estado).toBe('rechazada');
    expect(await stockOf(BRANCH_CENTRO, LECHE)).toMatchObject({
      disponible: '10.000',
      enTransito: '0.000',
    });
  });

  it('el origen cancela mientras no se recibió, y después ya no', async () => {
    await send(asNorte, 'post', `/inventario/transferencias/${transfer.id}/cancelacion`, {}, 403);

    const closed = await send<Transfer>(
      asBoth,
      'post',
      `/inventario/transferencias/${transfer.id}/cancelacion`,
    );

    expect(closed.estado).toBe('cancelada');
    expect(await stockOf(BRANCH_CENTRO, GALLETITAS)).toMatchObject({ disponible: '10.000' });
    await receive([], asNorte, 409);
  });

  it('el AS de origen ve la transferencia en su listado', async () => {
    const response = await request(api.app)
      .get('/inventario/transferencias')
      .set('Authorization', asBoth);

    expectToMatchContract(response, 'get', '/inventario/transferencias');
    expect((response.body as Transfer[]).map((t) => t.id)).toStrictEqual([transfer.id]);
  });

  it('[RF-148] un producto con una transferencia pendiente no se da de baja', async () => {
    const response = await request(api.app)
      .post(`/catalogo/productos/${LECHE}/baja`)
      .set('Authorization', ac);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'BAJA_CON_DEPENDENCIAS' });
  });

  it('[RF-148] una sucursal con stock no se da de baja', async () => {
    const response = await request(api.app)
      .post(`/organizacion/sucursales/${BRANCH_CENTRO}/baja`)
      .set('Authorization', ac);

    expect(response.status).toBe(409);
    expect((response.body as { mensaje: string }).mensaje).toContain('producto(s) con stock');
  });
});
