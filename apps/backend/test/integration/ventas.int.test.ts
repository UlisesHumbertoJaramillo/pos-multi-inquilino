// Ventas del POS: carrito con reservas, precio y promoción fijados, totales, descuento manual,
// cobro en efectivo atómico, descarte, traspasos, vencimientos y bajas con ventas en curso
// (T-145 a T-161; RF-030, RF-031, RF-050 a RF-060, RF-076 a RF-080, RF-116, RF-143, RF-146).
import type { Cart, SaleReceipt, SaleSearchResult, SaleTransfer } from '@pos/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PgOutboxDispatcher } from '../../src/compartido/adaptadores/outbox/pg-outbox-dispatcher.js';
import { createTestApi } from '../support/app.js';
import { createMemoryLogger } from '../support/logger.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerQuery, ownerSelect } from '../support/database.js';
import {
  BRANCH_CENTRO,
  BRANCH_NORTE,
  PIN,
  seedIdentity,
  signIn,
  TENANT_A,
  TENANT_B,
  USERS,
} from '../support/identity-fixtures.js';

const api = createTestApi();
afterAll(() => api.close());

const CAJA_1 = 'ab000000-0000-4000-8000-000000000001';
const CAJA_2 = 'ab000000-0000-4000-8000-000000000002';
const BEBIDAS = 'a4000000-0000-4000-8000-000000000001';
const AGUA = 'a5000000-0000-4000-8000-000000000001';
const GALLETITAS = 'a5000000-0000-4000-8000-000000000002';
const COMBO = 'a5000000-0000-4000-8000-000000000003';
const AJENO = 'b5000000-0000-4000-8000-000000000001';
const LISTA = 'a6000000-0000-4000-8000-000000000001';
const PROMO_2X1 = 'aa000000-0000-4000-8000-000000000001';

let vo: string;
let voAs: string; // as@prueba.local con el rol VO
let as: string;

beforeEach(async () => {
  api.clock.set('2026-11-02T12:00:00Z');
  await seedIdentity();
  await ownerQuery(
    `INSERT INTO caja (id, tenant_id, sucursal_id, nombre, creado_en) VALUES
       ($1, $3, $4, 'Caja 1', now()), ($2, $3, $4, 'Caja 2', now())`,
    [CAJA_1, CAJA_2, TENANT_A, BRANCH_CENTRO],
  );
  await ownerQuery(
    `INSERT INTO categoria (id, tenant_id, nombre, tasa_iva, creado_en)
     VALUES ($1, $2, 'Bebidas', 21, now())`,
    [BEBIDAS, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO producto (id, tenant_id, tipo, nombre, codigo_barras, categoria_id, costo, creado_en)
     VALUES ($1, $3, 'simple', 'Agua mineral', '7790001', $4, 100, now()),
            ($2, $3, 'simple', 'Galletitas', '7790002', $4, 100, now())`,
    [AGUA, GALLETITAS, TENANT_A, BEBIDAS],
  );
  await ownerQuery(
    `INSERT INTO producto (id, tenant_id, tipo, nombre, precio_combo, creado_en)
     VALUES ($1, $2, 'combo', 'Combo merienda', 450, now())`,
    [COMBO, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO combo_componente (id, tenant_id, combo_id, producto_id, cantidad, creado_en) VALUES
       (gen_random_uuid(), $1, $2, $3, 1, now()), (gen_random_uuid(), $1, $2, $4, 2, now())`,
    [TENANT_A, COMBO, AGUA, GALLETITAS],
  );
  await ownerQuery(
    `INSERT INTO lista_precio (id, tenant_id, nombre, regla, creado_en)
     VALUES ($1, $2, 'Minorista', 'fijo', now())`,
    [LISTA, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO precio_lista (id, tenant_id, lista_id, producto_id, precio_final, calculado_en) VALUES
       (gen_random_uuid(), $1, $2, $3, 300, now()), (gen_random_uuid(), $1, $2, $4, 100, now())`,
    [TENANT_A, LISTA, AGUA, GALLETITAS],
  );
  await ownerQuery('UPDATE sucursal SET lista_precio_activa_id = $1 WHERE id = $2', [
    LISTA,
    BRANCH_CENTRO,
  ]);
  await setStock(AGUA, 10);
  await setStock(GALLETITAS, 10);
  vo = (await signIn(api.app, USERS.vo.email, 'VO')).authorization;
  voAs = (await signIn(api.app, USERS.asVo.email, 'VO')).authorization;
  as = (await signIn(api.app, USERS.asVo.email, 'AS')).authorization;
});

async function setStock(productId: string, units: number) {
  await ownerQuery(
    `INSERT INTO inventario (id, tenant_id, sucursal_id, producto_id, disponible, actualizado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, now())
     ON CONFLICT (sucursal_id, producto_id) DO UPDATE SET disponible = EXCLUDED.disponible,
       reservado = 0`,
    [TENANT_A, BRANCH_CENTRO, productId, units],
  );
}

const stock = async (productId: string) =>
  (
    await ownerSelect<{ disponible: string; reservado: string }>(
      'SELECT disponible, reservado FROM inventario WHERE producto_id = $1',
      [productId],
    )
  )[0];

const post = (path: string, token: string, body: object = {}) =>
  request(api.app).post(path).set('Authorization', token).send(body);
const get = (path: string, token: string) => request(api.app).get(path).set('Authorization', token);

async function openShift(token = vo, caja = CAJA_1) {
  const response = await post('/caja/turnos', token, { cajaId: caja, saldoInicial: '1000' });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

async function newSale(token = vo): Promise<Cart> {
  const response = await post('/ventas', token);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as Cart;
}

const add = (saleId: string, productoId: string, cantidad: string, token = vo) =>
  post(`/ventas/${saleId}/items`, token, { productoId, cantidad });

async function cartWith(items: [string, string][], token = vo): Promise<Cart> {
  const sale = await newSale(token);
  let cart = sale;
  for (const [product, quantity] of items) {
    const response = await add(sale.id, product, quantity, token);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    cart = response.body as Cart;
  }
  return cart;
}

describe('[RF-053] [RF-054] venta y búsqueda', () => {
  it('un VO sin turno no puede empezar una venta', async () => {
    const response = await post('/ventas', vo);

    expect(response.status).toBe(409);
    expectToMatchContract(response, 'post', '/ventas');
    expect(response.body).toMatchObject({ codigo: 'SIN_TURNO' });
  });

  it('busca por código exacto y por nombre parcial, solo en el comercio propio', async () => {
    await ownerQuery(
      `INSERT INTO categoria (id, tenant_id, nombre, tasa_iva, creado_en)
       VALUES ('b4000000-0000-4000-8000-000000000001', $1, 'Otra', 21, now())`,
      [TENANT_B],
    );
    await ownerQuery(
      `INSERT INTO producto (id, tenant_id, tipo, nombre, codigo_barras, categoria_id, costo, creado_en)
       VALUES ($1, $2, 'simple', 'Agua ajena', '7790001', 'b4000000-0000-4000-8000-000000000001', 1, now())`,
      [AJENO, TENANT_B],
    );
    await openShift();

    const byCode = await get('/ventas/productos?q=7790001', vo);
    expect(byCode.status).toBe(200);
    expectToMatchContract(byCode, 'get', '/ventas/productos');
    expect(byCode.body).toEqual([
      {
        id: AGUA,
        nombre: 'Agua mineral',
        tipo: 'simple',
        codigoBarras: '7790001',
        precio: '300.00',
        disponible: '10.000',
      },
    ]);

    const byName = (await get('/ventas/productos?q=merien', vo)).body as SaleSearchResult[];
    // El combo se arma con 1 agua y 2 galletitas: con 10 y 10 alcanzan para 5.
    expect(byName).toEqual([
      expect.objectContaining({ id: COMBO, precio: '450.00', disponible: '5.000' }),
    ]);
  });
});

describe('[RF-030] [RF-055] [RF-056] [RF-051] agregar ítems con reserva', () => {
  beforeEach(() => openShift());

  it('reserva todo o nada e informa el disponible si no alcanza', async () => {
    await setStock(AGUA, 3);
    const sale = await newSale();

    const response = await add(sale.id, AGUA, '5');

    expect(response.status).toBe(409);
    expectToMatchContract(response, 'post', '/ventas/{id}/items');
    expect(response.body).toMatchObject({ codigo: 'STOCK_INSUFICIENTE' });
    expect((response.body as { mensaje: string }).mensaje).toContain('hay 3 disponible');
    expect(await stock(AGUA)).toEqual({ disponible: '3.000', reservado: '0.000' });
  });

  it('fija el precio de la lista de la sucursal y suma al mismo ítem', async () => {
    const cart = await cartWith([
      [AGUA, '2'],
      [AGUA, '1'],
    ]);

    expect(cart.items).toEqual([
      expect.objectContaining({
        productoId: AGUA,
        cantidad: '3.000',
        precioUnitario: '300.00',
        importeFinal: '900.00',
      }),
    ]);
    expect(cart.total).toBe('900.00');
    expect(cart.iva).toEqual([{ tasa: '21.0000', base: '900.00', neto: '743.80', iva: '156.20' }]);
    expect(await stock(AGUA)).toEqual({ disponible: '7.000', reservado: '3.000' });
  });

  it('un combo reserva cada componente', async () => {
    const cart = await cartWith([[COMBO, '2']]);

    expect(cart.items[0]).toMatchObject({
      tipo: 'combo',
      precioUnitario: '450.00',
      importeFinal: '900.00',
    });
    expect(await stock(AGUA)).toEqual({ disponible: '8.000', reservado: '2.000' });
    expect(await stock(GALLETITAS)).toEqual({ disponible: '6.000', reservado: '4.000' });
  });

  it('un producto sin precio en la lista no se puede agregar', async () => {
    await ownerQuery('UPDATE precio_lista SET precio_final = NULL WHERE producto_id = $1', [AGUA]);
    const sale = await newSale();

    expect((await add(sale.id, AGUA, '1')).body).toMatchObject({ codigo: 'SIN_PRECIO' });
  });
});

describe('[RF-058] [RF-116] quitar ítems y descartar', () => {
  beforeEach(() => openShift());

  it('quitar un ítem libera su reserva y cambiar la cantidad reserva o libera la diferencia', async () => {
    const cart = await cartWith([
      [AGUA, '4'],
      [GALLETITAS, '2'],
    ]);
    const agua = cart.items.find((i) => i.productoId === AGUA);
    if (!agua) throw new Error('Falta el ítem');

    const fewer = await request(api.app)
      .patch(`/ventas/${cart.id}/items/${agua.id}`)
      .set('Authorization', vo)
      .send({ cantidad: '1' });
    expect(fewer.status).toBe(200);
    expectToMatchContract(fewer, 'patch', '/ventas/{id}/items/{itemId}');
    expect(await stock(AGUA)).toEqual({ disponible: '9.000', reservado: '1.000' });

    const removed = await post(`/ventas/${cart.id}/items/${agua.id}/baja`, vo);
    expect(removed.status).toBe(200);
    expect((removed.body as Cart).items.map((i) => i.productoId)).toEqual([GALLETITAS]);
    expect(await stock(AGUA)).toEqual({ disponible: '10.000', reservado: '0.000' });
  });

  it('descartar libera todo y conserva la venta con el motivo manual', async () => {
    const cart = await cartWith([[AGUA, '2']]);

    const response = await post(`/ventas/${cart.id}/descarte`, vo);

    expect(response.status).toBe(204);
    expect(await stock(AGUA)).toEqual({ disponible: '10.000', reservado: '0.000' });
    const rows = await ownerSelect('SELECT estado_comercial, motivo_descarte FROM venta');
    expect(rows).toEqual([{ estado_comercial: 'descartada', motivo_descarte: 'manual' }]);
  });
});

describe('[RF-031] [RF-143] [RF-050] precio y promoción fijados, totales del motor', () => {
  beforeEach(async () => {
    await openShift();
    await ownerQuery(
      `INSERT INTO promocion (id, tenant_id, nombre, tipo, alcance, producto_id, parametros,
         vigente_desde, vigente_hasta, creado_en)
       VALUES ($1, $2, '2x1 en agua', 'nxm', 'producto', $3, '{"lleva": 2, "paga": 1}',
         '2026-11-01T00:00:00Z', '2026-11-02T12:10:00Z', now())`,
      [PROMO_2X1, TENANT_A, AGUA],
    );
  });

  it('dos unidades con un 2x1 devuelven el descuento aplicado y resaltado', async () => {
    const cart = await cartWith([[AGUA, '2']]);

    expect(cart.items[0]).toMatchObject({
      promocion: { id: PROMO_2X1, nombre: '2x1 en agua' },
      descuentoPromocion: '300.00',
      importeFinal: '300.00',
    });
    expect(cart).toMatchObject({
      subtotal: '300.00',
      descuentoPromociones: '300.00',
      total: '300.00',
    });
  });

  it('el ítem conserva su precio y su promoción aunque cambie la lista o venza la promoción', async () => {
    const cart = await cartWith([[AGUA, '2']]);
    await ownerQuery('UPDATE precio_lista SET precio_final = 999 WHERE producto_id = $1', [AGUA]);
    api.clock.advance(11 * 60_000); // la promoción vence a las 12:10
    vo = (await signIn(api.app, USERS.vo.email, 'VO')).authorization;

    const later = (await add(cart.id, GALLETITAS, '1')).body as Cart;

    expect(later.items.find((i) => i.productoId === AGUA)).toMatchObject({
      precioUnitario: '300.00',
      promocion: { id: PROMO_2X1 },
      descuentoPromocion: '300.00',
    });
  });
});

describe('[RF-065] [RF-066] descuento manual con cuota', () => {
  beforeEach(async () => {
    await ownerQuery(
      `INSERT INTO tope_cuota (tenant_id, pct_max_venta, monto_max, actualizado_en, actualizado_por)
       VALUES ($1, 20, 5000, now(), $2)`,
      [TENANT_A, USERS.ac.id],
    );
    await ownerQuery(
      `INSERT INTO cuota_vo (id, tenant_id, usuario_id, sucursal_id, pct_max_venta, monto,
         actualizado_en, actualizado_por)
       VALUES (gen_random_uuid(), $1, $2, $3, 10, 1000, now(), $4)`,
      [TENANT_A, USERS.vo.id, BRANCH_CENTRO, USERS.asVo.id],
    );
    await openShift();
  });

  const discount = (saleId: string, descuento: object | null, autorizacionId?: string) =>
    request(api.app)
      .put(`/ventas/${saleId}/descuento`)
      .set('Authorization', vo)
      .send({ descuento, ...(autorizacionId ? { autorizacionId } : {}) });

  it('dentro de la cuota se aplica sin PIN y el saldo se consume al cobrar', async () => {
    const cart = await cartWith([[AGUA, '3']]); // 900

    const response = await discount(cart.id, { tipo: 'porcentaje', valor: '10' });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expectToMatchContract(response, 'put', '/ventas/{id}/descuento');
    expect(response.body).toMatchObject({
      descuentoManual: '90.00',
      total: '810.00',
      descuento: { tipo: 'porcentaje', valor: '10.0000', autorizado: false },
    });
    const balance = () => ownerSelect<{ saldo: string }>('SELECT saldo FROM saldo_cuota');
    expect(await balance()).toEqual([{ saldo: '1000.00' }]);

    expect((await post(`/ventas/${cart.id}/cobro`, vo)).status).toBe(200);
    expect(await balance()).toEqual([{ saldo: '910.00' }]);
  });

  it('uno mayor pide autorización y, autorizado, no consume la cuota', async () => {
    const cart = await cartWith([[AGUA, '3']]);

    const rejected = await discount(cart.id, { tipo: 'monto', valor: '200' });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({ codigo: 'DESCUENTO_REQUIERE_AUTORIZACION' });

    const authorization = await post('/autorizaciones', vo, {
      tipo: 'descuento',
      operacionRef: `descuento:${cart.id}`,
      sucursalId: BRANCH_CENTRO,
      autorizanteId: USERS.asVo.id,
      pin: PIN,
    });
    const id = (authorization.body as { id: string }).id;
    const accepted = await discount(cart.id, { tipo: 'monto', valor: '200' }, id);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body).toMatchObject({ total: '700.00', descuento: { autorizado: true } });

    expect((await post(`/ventas/${cart.id}/cobro`, vo)).status).toBe(200);
    expect(await ownerSelect('SELECT saldo FROM saldo_cuota')).toEqual([{ saldo: '1000.00' }]);
    const audit = await ownerSelect<{ autorizacion_id: string }>(
      "SELECT autorizacion_id FROM auditoria_comercial WHERE accion = 'descuento_fuera_de_cuota'",
    );
    expect(audit).toEqual([{ autorizacion_id: id }]);
  });
});

describe('[RF-076] [RF-153] cobro en efectivo', () => {
  beforeEach(() => openShift());

  it('confirma de forma atómica: consume, numera, cobra con vuelto e ingresa a caja', async () => {
    const cart = await cartWith([[AGUA, '2']]);

    const response = await post(`/ventas/${cart.id}/cobro`, vo, { entregado: '1000' });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expectToMatchContract(response, 'post', '/ventas/{id}/cobro');
    const receipt = response.body as SaleReceipt;
    expect(receipt).toMatchObject({
      numeroTicket: 1,
      cobrado: '600.00',
      entregado: '1000.00',
      vuelto: '400.00',
      seFactura: false,
      estadoFiscal: 'no_se_factura',
      venta: { estado: 'confirmada', numeroTicket: 1 },
    });
    expect(await stock(AGUA)).toEqual({ disponible: '8.000', reservado: '0.000' });
    expect(await ownerSelect('SELECT tipo, monto FROM movimiento_caja')).toEqual([
      { tipo: 'venta', monto: '600.00' },
    ]);
    expect(await ownerSelect('SELECT estado_cobro FROM venta')).toEqual([
      { estado_cobro: 'pagada' },
    ]);

    const second = await cartWith([[GALLETITAS, '1']]);
    expect(((await post(`/ventas/${second.id}/cobro`, vo)).body as SaleReceipt).numeroTicket).toBe(
      2,
    );
  });

  it('con el módulo de facturación deja el pedido del comprobante en el outbox', async () => {
    await ownerQuery('UPDATE comercio SET modulo_facturacion = true WHERE id = $1', [TENANT_A]);
    const cart = await cartWith([[AGUA, '1']]);

    const receipt = (await post(`/ventas/${cart.id}/cobro`, vo)).body as SaleReceipt;

    expect(receipt).toMatchObject({ seFactura: true, estadoFiscal: 'pendiente' });
    const events = await ownerSelect<{ tipo_evento: string; payload: unknown }>(
      "SELECT tipo_evento, payload FROM outbox WHERE tipo_evento = 'comprobante.solicitado'",
    );
    expect(events).toEqual([
      { tipo_evento: 'comprobante.solicitado', payload: { ventaId: cart.id } },
    ]);
  });

  it('una falla a mitad de la confirmación no deja cambios parciales', async () => {
    const cart = await cartWith([[AGUA, '2']]);
    await ownerQuery(`CREATE FUNCTION falla_prueba() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'falla simulada'; END; $$`);
    await ownerQuery(`CREATE TRIGGER falla_prueba BEFORE INSERT ON movimiento_caja
      FOR EACH ROW EXECUTE FUNCTION falla_prueba()`);
    try {
      const response = await post(`/ventas/${cart.id}/cobro`, vo);
      expect(response.status).toBe(500);
    } finally {
      await ownerQuery('DROP TRIGGER falla_prueba ON movimiento_caja');
      await ownerQuery('DROP FUNCTION falla_prueba()');
    }

    expect(await stock(AGUA)).toEqual({ disponible: '8.000', reservado: '2.000' });
    expect(await ownerSelect('SELECT estado_comercial, numero_ticket FROM venta')).toEqual([
      { estado_comercial: 'en_curso', numero_ticket: null },
    ]);
    expect(await ownerSelect('SELECT id FROM pago')).toEqual([]);
    expect(await ownerSelect('SELECT ultimo FROM numerador_ticket')).toEqual([]);
  });

  it('lo entregado tiene que cubrir el total', async () => {
    const cart = await cartWith([[AGUA, '2']]);

    const response = await post(`/ventas/${cart.id}/cobro`, vo, { entregado: '500' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'PAGO_INSUFICIENTE' });
  });
});

describe('[RF-057] [RF-152] la última unidad entre dos VO', () => {
  it('con 20 repeticiones, uno solo la obtiene y el otro recibe sin stock', async () => {
    await openShift(vo, CAJA_1);
    await openShift(voAs, CAJA_2);
    for (let round = 0; round < 20; round++) {
      await setStock(AGUA, 1);
      const [a, b] = [await newSale(vo), await newSale(voAs)];
      const results = await Promise.all([add(a.id, AGUA, '1', vo), add(b.id, AGUA, '1', voAs)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const loser = results.find((r) => r.status === 409);
      expect(loser?.body).toMatchObject({ codigo: 'STOCK_INSUFICIENTE' });
      expect(await stock(AGUA)).toEqual({ disponible: '0.000', reservado: '1.000' });
      await post(`/ventas/${a.id}/descarte`, vo);
      await post(`/ventas/${b.id}/descarte`, voAs);
    }
  });
});

describe('[RF-059] [RF-146] [RF-117] [RF-115] vencimiento, suspensión y caja', () => {
  beforeEach(() => openShift());

  it('un carrito inactivo vence: se descarta por inactividad y libera el stock', async () => {
    const cart = await cartWith([[AGUA, '2']]);
    const jobs = await ownerSelect<{ tipo: string }>('SELECT tipo FROM trabajo_programado');
    expect(jobs).toEqual([{ tipo: 'ventas.vencer_carrito' }]);

    api.clock.advance(10 * 60_000);
    await api.sales.maintenance.expireCart(TENANT_A, cart.id);
    expect(await ownerSelect('SELECT estado_comercial FROM venta')).toEqual([
      { estado_comercial: 'en_curso' },
    ]);

    api.clock.advance(6 * 60_000);
    await api.sales.maintenance.expireCart(TENANT_A, cart.id);
    expect(await ownerSelect('SELECT estado_comercial, motivo_descarte FROM venta')).toEqual([
      { estado_comercial: 'descartada', motivo_descarte: 'inactividad' },
    ]);
    expect(await stock(AGUA)).toEqual({ disponible: '10.000', reservado: '0.000' });
  });

  it('al suspender el comercio sus carritos pasan a descartados y el stock vuelve', async () => {
    await cartWith([[AGUA, '3']]);

    // A través del despachador real del worker, como en producción.
    await ownerQuery(
      `INSERT INTO outbox (id, tenant_id, tipo_evento, payload, creado_en, proximo_intento)
       VALUES (gen_random_uuid(), NULL, 'comercio.suspendido', $1, $2, $2)`,
      [{ tenantId: TENANT_A }, api.clock.now()],
    );
    const dispatcher = new PgOutboxDispatcher(api.db, api.clock, createMemoryLogger(), {
      handlers: api.sales.eventHandlers,
    });
    expect(await dispatcher.dispatchOnce()).toBe(1);
    expect(await ownerSelect('SELECT ultimo_error FROM outbox')).toEqual([{ ultimo_error: null }]);

    expect(await ownerSelect('SELECT motivo_descarte FROM venta')).toEqual([
      { motivo_descarte: 'suspension' },
    ]);
    expect(await stock(AGUA)).toEqual({ disponible: '10.000', reservado: '0.000' });
  });

  it('un Corte X con una venta en curso se rechaza indicando cuál', async () => {
    const cart = await cartWith([[AGUA, '1']]);

    const response = await post('/caja/turno/corte-x', vo, { declarado: '1000' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'VENTAS_EN_CURSO' });
    expect((response.body as { mensaje: string }).mensaje).toContain(cart.id.slice(0, 8));
  });

  it('el cierre forzado descarta las ventas en curso del turno', async () => {
    await cartWith([[AGUA, '2']]);
    const shift = (await ownerSelect<{ id: string }>('SELECT id FROM turno'))[0];

    const response = await post(`/caja/turnos/${shift?.id ?? ''}/cierre-forzado`, as, {
      declarado: '1000',
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await ownerSelect('SELECT motivo_descarte FROM venta')).toEqual([
      { motivo_descarte: 'cierre_forzado' },
    ]);
    expect(await stock(AGUA)).toEqual({ disponible: '10.000', reservado: '0.000' });
  });
});

describe('[RF-077] [RF-078] [RF-079] traspasos', () => {
  beforeEach(async () => {
    await openShift(vo, CAJA_1);
    await openShift(voAs, CAJA_2);
  });

  async function sendTransfer(): Promise<{ cart: Cart; transfer: SaleTransfer }> {
    const cart = await cartWith([[AGUA, '2']]);
    const targets = await get(`/ventas/${cart.id}/receptores`, vo);
    expectToMatchContract(targets, 'get', '/ventas/{id}/receptores');
    expect(targets.body).toEqual([{ id: USERS.asVo.id, nombre: 'Admin Sucursal' }]);
    const response = await post(`/ventas/${cart.id}/traspaso`, vo, { receptorId: USERS.asVo.id });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expectToMatchContract(response, 'post', '/ventas/{id}/traspaso');
    return { cart, transfer: response.body as SaleTransfer };
  }

  it('aceptar pasa la venta y sus reservas al receptor sin liberarlas', async () => {
    const { cart, transfer } = await sendTransfer();
    expect((await add(cart.id, GALLETITAS, '1')).body).toMatchObject({
      codigo: 'TRASPASO_PENDIENTE',
    });
    const incoming = await get('/ventas', voAs);
    expectToMatchContract(incoming, 'get', '/ventas');
    expect(incoming.body).toMatchObject({
      traspasosRecibidos: [{ id: transfer.id, ventaId: cart.id }],
    });

    const accepted = await post(`/ventas/traspasos/${transfer.id}/aceptacion`, voAs);

    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body).toMatchObject({ id: cart.id, vendedorId: USERS.asVo.id });
    expect(await stock(AGUA)).toEqual({ disponible: '8.000', reservado: '2.000' });
    expect((await get(`/ventas/${cart.id}`, vo)).status).toBe(403);
  });

  it('rechazar devuelve la venta al emisor', async () => {
    const { cart, transfer } = await sendTransfer();

    expect((await post(`/ventas/traspasos/${transfer.id}/rechazo`, voAs)).status).toBe(204);

    expect((await add(cart.id, GALLETITAS, '1')).status).toBe(200);
  });

  it('un traspaso no aceptado a tiempo vence y la venta vuelve al emisor', async () => {
    const { cart, transfer } = await sendTransfer();
    api.clock.advance(16 * 60_000);
    vo = (await signIn(api.app, USERS.vo.email, 'VO')).authorization;
    voAs = (await signIn(api.app, USERS.asVo.email, 'VO')).authorization;

    const late = await post(`/ventas/traspasos/${transfer.id}/aceptacion`, voAs);
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ codigo: 'TRASPASO_VENCIDO' });
    expect(await ownerSelect('SELECT estado FROM traspaso')).toEqual([{ estado: 'vencido' }]);
    expect((await add(cart.id, GALLETITAS, '1')).status).toBe(200);
  });
});

describe('[RF-080] cierre de sesión con turno o ventas en curso', () => {
  it('pide resolver las ventas y cerrar el turno antes de salir', async () => {
    await openShift();
    const cart = await cartWith([[AGUA, '1']]);

    const blocked = await post('/auth/cerrar-sesion', vo);
    expect(blocked.status).toBe(409);
    expectToMatchContract(blocked, 'post', '/auth/cerrar-sesion');
    expect(blocked.body).toMatchObject({ codigo: 'CIERRE_PENDIENTE' });
    const message = (blocked.body as { mensaje: string }).mensaje;
    expect(message).toContain(cart.id.slice(0, 8));
    expect(message).toContain('Corte X');

    await post(`/ventas/${cart.id}/descarte`, vo);
    await post('/caja/turno/corte-x', vo, { declarado: '1000' });
    expect((await post('/auth/cerrar-sesion', vo)).status).toBe(204);
  });
});

describe('[RF-025] [RF-148] bajas con ventas en curso', () => {
  beforeEach(async () => {
    await openShift();
    await cartWith([[AGUA, '1']]);
  });

  it.each([
    ['la sucursal', `/organizacion/sucursales/${BRANCH_CENTRO}/baja`],
    ['la caja', `/organizacion/cajas/${CAJA_1}/baja`],
    ['el usuario', `/organizacion/usuarios/${USERS.vo.id}/baja`],
  ])('no se da de baja %s e indica la causa', async (_what, path) => {
    const ac = (await signIn(api.app, USERS.ac.email)).authorization;

    const response = await post(path, ac);

    expect(response.status).toBe(409);
    expect((response.body as { mensaje: string }).mensaje).toContain('venta(s) en curso');
  });

  it('no se da de baja un producto reservado en un carrito', async () => {
    const ac = (await signIn(api.app, USERS.ac.email)).authorization;

    const response = await post(`/catalogo/productos/${AGUA}/baja`, ac);

    expect(response.status).toBe(409);
    expect((response.body as { mensaje: string }).mensaje).toMatch(/reserva/i);
  });

  it('la venta de otro VO no se ve ni se modifica; la de otro comercio no existe', async () => {
    const own = (await ownerSelect<{ id: string }>('SELECT id FROM venta'))[0]?.id ?? '';
    await openShift(voAs, CAJA_2);

    expect((await get(`/ventas/${own}`, voAs)).status).toBe(403);
    const other = (await signIn(api.app, USERS.voB.email, 'VO')).authorization;
    expect((await get(`/ventas/${own}`, other)).status).toBe(404);
    expect((await get(`/ventas/${BRANCH_NORTE}`, vo)).status).toBe(404);
  });
});
