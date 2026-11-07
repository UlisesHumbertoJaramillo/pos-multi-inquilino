// Cobros, clientes y crédito: pago mixto, crédito con su límite y exceso, cobros de cuenta
// corriente con recibo, pagos electrónicos con el simulador, pago por verificar, reversión y
// aprobación tardía (T-166 a T-179; RF-068 a RF-075, RF-125 a RF-129, RF-132, RF-144, RF-152).
import { randomUUID } from 'node:crypto';
import type {
  AccountCollection,
  Cart,
  Customer,
  SalePaymentAttempt,
  SaleReceipt,
} from '@pos/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerQuery, ownerSelect } from '../support/database.js';
import {
  BRANCH_CENTRO,
  PIN,
  seedIdentity,
  signIn,
  TENANT_A,
  USERS,
} from '../support/identity-fixtures.js';

const api = createTestApi();
afterAll(() => api.close());

const CAJA_1 = 'ab000000-0000-4000-8000-000000000001';
const CAJA_2 = 'ab000000-0000-4000-8000-000000000002';
const BEBIDAS = 'a4000000-0000-4000-8000-000000000001';
const AGUA = 'a5000000-0000-4000-8000-000000000001';
const LISTA = 'a6000000-0000-4000-8000-000000000001';
const EFECTIVO = 'a3000000-0000-4000-8000-000000000001';
const DEBITO = 'a3000000-0000-4000-8000-000000000002';
const TARJETA = 'a3000000-0000-4000-8000-000000000003';
const CUENTA = 'a3000000-0000-4000-8000-000000000004';

let vo: string;
let voAs: string;
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
    `INSERT INTO metodo_pago (id, tenant_id, nombre, tipo, recargo_pct, creado_en) VALUES
       ($1, $5, 'Efectivo', 'efectivo', 0, now()),
       ($2, $5, 'Débito', 'electronico', 0, now()),
       ($3, $5, 'Tarjeta', 'electronico', 10, now()),
       ($4, $5, 'Cuenta corriente', 'cuenta_corriente', 0, now())`,
    [EFECTIVO, DEBITO, TARJETA, CUENTA, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO categoria (id, tenant_id, nombre, tasa_iva, creado_en)
     VALUES ($1, $2, 'Bebidas', 21, now())`,
    [BEBIDAS, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO producto (id, tenant_id, tipo, nombre, codigo_barras, categoria_id, costo, creado_en)
     VALUES ($1, $2, 'simple', 'Agua mineral', '7790001', $3, 100, now())`,
    [AGUA, TENANT_A, BEBIDAS],
  );
  await ownerQuery(
    `INSERT INTO lista_precio (id, tenant_id, nombre, regla, creado_en)
     VALUES ($1, $2, 'Minorista', 'fijo', now())`,
    [LISTA, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO precio_lista (id, tenant_id, lista_id, producto_id, precio_final, calculado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, 1000, now())`,
    [TENANT_A, LISTA, AGUA],
  );
  await ownerQuery('UPDATE sucursal SET lista_precio_activa_id = $1 WHERE id = $2', [
    LISTA,
    BRANCH_CENTRO,
  ]);
  await ownerQuery(
    `INSERT INTO inventario (id, tenant_id, sucursal_id, producto_id, disponible, actualizado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, 1000, now())`,
    [TENANT_A, BRANCH_CENTRO, AGUA],
  );
  await signAll();
});

async function signAll() {
  vo = (await signIn(api.app, USERS.vo.email, 'VO')).authorization;
  voAs = (await signIn(api.app, USERS.asVo.email, 'VO')).authorization;
  as = (await signIn(api.app, USERS.asVo.email, 'AS')).authorization;
}

const post = (path: string, token: string, body: object = {}) =>
  request(api.app).post(path).set('Authorization', token).send(body);
const put = (path: string, token: string, body: object = {}) =>
  request(api.app).put(path).set('Authorization', token).send(body);
const get = (path: string, token: string) => request(api.app).get(path).set('Authorization', token);

const setMode = async (modo: string) => {
  const response = await put('/simulador/pasarela', vo, { modo });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
};

async function openShift(token = vo, caja = CAJA_1) {
  const response = await post('/caja/turnos', token, { cajaId: caja, saldoInicial: '1000' });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

async function cart(units = '1', token = vo): Promise<Cart> {
  const started = await post('/ventas', token);
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const id = (started.body as Cart).id;
  const added = await post(`/ventas/${id}/items`, token, { productoId: AGUA, cantidad: units });
  expect(added.status, JSON.stringify(added.body)).toBe(200);
  return added.body as Cart;
}

const charge = (saleId: string, metodoPagoId: string, fraccion: string, token = vo) =>
  post(`/ventas/${saleId}/pagos`, token, {
    metodoPagoId,
    fraccion,
    claveIdempotencia: randomUUID(),
  });

async function customer(limit: string | null = '5000'): Promise<Customer> {
  const created = await post('/clientes', as, {
    razonSocial: `Cliente ${randomUUID().slice(0, 8)}`,
    condicionFiscal: 'consumidor_final',
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const body = created.body as Customer;
  if (limit === null) return body;
  const credit = await put(`/clientes/${body.id}/credito`, as, {
    cuentaCorriente: true,
    limite: limit,
  });
  expect(credit.status, JSON.stringify(credit.body)).toBe(200);
  return credit.body as Customer;
}

const setCustomer = async (saleId: string, clienteId: string, token = vo) => {
  const response = await put(`/ventas/${saleId}/cliente`, token, { clienteId });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
};

const balance = async (id: string) =>
  (await ownerSelect<{ saldo: string }>('SELECT saldo FROM cliente WHERE id = $1', [id]))[0]?.saldo;

const movements = (type: string) =>
  ownerSelect<{ monto: string; en_efectivo: boolean }>(
    'SELECT monto, en_efectivo FROM movimiento_caja WHERE tipo = $1 ORDER BY registrado_en',
    [type],
  );

const stockReserved = async () =>
  (await ownerSelect<{ reservado: string }>('SELECT reservado FROM inventario'))[0]?.reservado;

async function pin(type: string, operacionRef: string) {
  const response = await post('/autorizaciones', vo, {
    tipo: type,
    operacionRef,
    sucursalId: BRANCH_CENTRO,
    autorizanteId: USERS.asVo.id,
    pin: PIN,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return (response.body as { id: string }).id;
}

// Tres consultas sin respuesta del worker habilitan la resolución manual.
async function verifyTimes(paymentId: string, times = 3) {
  for (let i = 0; i < times; i++) await api.sales.verification.verify(TENANT_A, paymentId);
}

describe('[RF-132] [RF-072] clientes y límite de crédito', () => {
  it('el AS crea un cliente, lo modifica y fija su límite; lo ve todo el comercio', async () => {
    const created = await post('/clientes', as, {
      razonSocial: ' Kiosco Sur ',
      documento: '30-11111111-1',
      condicionFiscal: 'responsable_inscripto',
    });
    expect(created.status).toBe(201);
    expectToMatchContract(created, 'post', '/clientes');
    const id = (created.body as Customer).id;
    expect(created.body).toMatchObject({ razonSocial: 'Kiosco Sur', cuentaCorriente: false });

    const credit = await put(`/clientes/${id}/credito`, as, {
      cuentaCorriente: true,
      limite: '1500',
    });
    expect(credit.body).toMatchObject({ limiteCredito: '1500.00', disponible: '1500.00' });

    const edited = await put(`/clientes/${id}`, as, {
      razonSocial: 'Kiosco del Sur',
      documento: '30-11111111-1',
      condicionFiscal: 'monotributista',
    });
    expect(edited.status).toBe(200);
    const listed = await get('/clientes', as);
    expectToMatchContract(listed, 'get', '/clientes');
    expect(listed.body).toMatchObject([{ razonSocial: 'Kiosco del Sur' }]);
  });

  it('un VO no gestiona clientes ni fija límites, pero los puede buscar', async () => {
    const found = await customer();
    expect(
      (await put(`/clientes/${found.id}/credito`, vo, { cuentaCorriente: true, limite: '9' }))
        .status,
    ).toBe(403);
    const search = await get(`/ventas/clientes?q=${found.razonSocial.slice(0, 10)}`, vo);
    expectToMatchContract(search, 'get', '/ventas/clientes');
    expect(search.body).toMatchObject([{ id: found.id, disponible: '5000.00' }]);
  });

  it('el documento no se repite entre clientes activos', async () => {
    const body = { razonSocial: 'A', documento: '123', condicionFiscal: 'consumidor_final' };
    expect((await post('/clientes', as, body)).status).toBe(201);
    const repeated = await post('/clientes', as, body);
    expect(repeated.status).toBe(409);
    expect(repeated.body).toMatchObject({ codigo: 'CLIENTE_DUPLICADO' });
  });

  it('un cliente con deuda no se da de baja ni pierde la cuenta corriente (D-86)', async () => {
    await openShift();
    const client = await customer();
    const sale = await cart();
    await setCustomer(sale.id, client.id);
    await post(`/ventas/${sale.id}/cobro`, vo, {
      pagos: [{ metodoPagoId: CUENTA, fraccion: '1000' }],
    });
    const baja = await post(`/clientes/${client.id}/baja`, as);
    expect(baja.status).toBe(409);
    expect(baja.body).toMatchObject({ codigo: 'CLIENTE_CON_SALDO' });
    const without = await put(`/clientes/${client.id}/credito`, as, {
      cuentaCorriente: false,
      limite: '0',
    });
    expect(without.body).toMatchObject({ codigo: 'CLIENTE_CON_SALDO' });
  });
});

describe('[RF-068] [RF-069] [RF-070] [RF-071] pago mixto', () => {
  beforeEach(() => openShift());

  it('efectivo + tarjeta con recargo: el recargo va solo sobre su fracción', async () => {
    const sale = await cart('2');
    const first = await charge(sale.id, TARJETA, '1200');
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expectToMatchContract(first, 'post', '/ventas/{id}/pagos');
    const attempt = first.body as SalePaymentAttempt;
    expect(attempt.pago).toMatchObject({
      estado: 'aprobado',
      fraccion: '1200.00',
      recargo: '120.00',
    });
    expect(attempt.venta.porCobrar).toBe('800.00');

    const paid = await post(`/ventas/${sale.id}/cobro`, vo, {
      pagos: [{ metodoPagoId: EFECTIVO, fraccion: '800', entregado: '1000' }],
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expectToMatchContract(paid, 'post', '/ventas/{id}/cobro');
    expect(paid.body).toMatchObject({
      cobrado: '2120.00',
      ajuste: '120.00',
      entregado: '1000.00',
      vuelto: '200.00',
      estadoCobro: 'pagada',
    });
    // Solo el efectivo suma al teórico; la tarjeta queda en el turno sin ser efectivo.
    expect(await movements('venta')).toEqual(
      expect.arrayContaining([
        { monto: '800.00', en_efectivo: true },
        { monto: '1320.00', en_efectivo: false },
      ]),
    );
  });

  it('si las fracciones no igualan el total, no se confirma', async () => {
    const sale = await cart();
    const paid = await post(`/ventas/${sale.id}/cobro`, vo, {
      pagos: [{ metodoPagoId: EFECTIVO, fraccion: '900' }],
    });
    expect(paid.body).toMatchObject({ codigo: 'FRACCIONES_NO_CUADRAN' });
    expect((await ownerSelect('SELECT 1 FROM pago')).length).toBe(0);
  });

  it('una fracción electrónica no puede superar lo que falta cobrar', async () => {
    const sale = await cart();
    const response = await charge(sale.id, DEBITO, '1000.01');
    expect(response.body).toMatchObject({ codigo: 'FRACCIONES_NO_CUADRAN' });
  });

  it('lo electrónico se cobra con la pasarela, no al confirmar', async () => {
    const sale = await cart();
    const paid = await post(`/ventas/${sale.id}/cobro`, vo, {
      pagos: [{ metodoPagoId: DEBITO, fraccion: '1000' }],
    });
    expect(paid.body).toMatchObject({ codigo: 'METODO_INVALIDO' });
  });

  it('una venta pagada entera con la pasarela se confirma sin más medios', async () => {
    const sale = await cart();
    await charge(sale.id, DEBITO, '1000');
    const paid = await post(`/ventas/${sale.id}/cobro`, vo, { pagos: [] });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body).toMatchObject({ cobrado: '1000.00', vuelto: '0.00' });
  });
});

describe('[RF-073] [RF-074] [RF-144] venta a crédito', () => {
  beforeEach(() => openShift());

  it('dentro del límite sube el saldo y la venta queda con saldo en cuenta corriente', async () => {
    const client = await customer();
    const sale = await cart('2');
    await setCustomer(sale.id, client.id);
    const paid = await post(`/ventas/${sale.id}/cobro`, vo, {
      pagos: [
        { metodoPagoId: CUENTA, fraccion: '1500' },
        { metodoPagoId: EFECTIVO, fraccion: '500' },
      ],
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect((paid.body as SaleReceipt).estadoCobro).toBe('saldo_cuenta_corriente');
    expect(await balance(client.id)).toBe('1500.00');
    expect(await movements('venta')).toEqual([{ monto: '500.00', en_efectivo: true }]);
  });

  it('un cliente sin cuenta corriente, o sin cliente, se rechaza', async () => {
    const sale = await cart();
    const lines = { pagos: [{ metodoPagoId: CUENTA, fraccion: '1000' }] };
    const none = await post(`/ventas/${sale.id}/cobro`, vo, lines);
    expect(none.body).toMatchObject({ codigo: 'CLIENTE_REQUERIDO' });
    const client = await customer(null);
    await setCustomer(sale.id, client.id);
    const rejected = await post(`/ventas/${sale.id}/cobro`, vo, lines);
    expect(rejected.body).toMatchObject({ codigo: 'CLIENTE_SIN_CREDITO' });
  });

  it('un cliente dado de baja no se puede asociar a una venta', async () => {
    const client = await customer();
    await post(`/clientes/${client.id}/baja`, as);
    const sale = await cart();
    const response = await put(`/ventas/${sale.id}/cliente`, vo, { clienteId: client.id });
    expect(response.body).toMatchObject({ codigo: 'CLIENTE_INVALIDO' });
  });

  it('un exceso se rechaza informando el disponible y con PIN se confirma y se audita', async () => {
    const client = await customer('800');
    const sale = await cart();
    await setCustomer(sale.id, client.id);
    const lines = [{ metodoPagoId: CUENTA, fraccion: '1000' }];
    const rejected = await post(`/ventas/${sale.id}/cobro`, vo, { pagos: lines });
    expect(rejected.body).toMatchObject({ codigo: 'CREDITO_EXCEDIDO' });
    expect((rejected.body as { mensaje: string }).mensaje).toContain('800.00');
    expect(await balance(client.id)).toBe('0.00');

    const autorizacionId = await pin('credito', `credito:${sale.id}:1000.00`);
    const paid = await post(`/ventas/${sale.id}/cobro`, vo, { pagos: lines, autorizacionId });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(await balance(client.id)).toBe('1000.00');
    const audit = await ownerSelect<{ autorizacion_id: string }>(
      "SELECT autorizacion_id FROM auditoria_comercial WHERE accion = 'exceso_de_credito'",
    );
    expect(audit).toEqual([{ autorizacion_id: autorizacionId }]);
  });

  it('[RF-152] dos ventas simultáneas nunca superan el límite (20 repeticiones)', async () => {
    await openShift(voAs, CAJA_2);
    const client = await customer('1000');
    const lines = { pagos: [{ metodoPagoId: CUENTA, fraccion: '1000' }] };
    for (let round = 0; round < 20; round++) {
      await ownerQuery('UPDATE cliente SET saldo = 0 WHERE id = $1', [client.id]);
      const [a, b] = [await cart('1', vo), await cart('1', voAs)];
      await setCustomer(a.id, client.id, vo);
      await setCustomer(b.id, client.id, voAs);
      const results = await Promise.all([
        post(`/ventas/${a.id}/cobro`, vo, lines),
        post(`/ventas/${b.id}/cobro`, voAs, lines),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await balance(client.id)).toBe('1000.00');
      const loser = results[0].status === 409 ? [a, vo] : [b, voAs];
      await post(`/ventas/${(loser[0] as Cart).id}/descarte`, loser[1] as string);
    }
  }, 30_000);
});

describe('[RF-128] [RF-129] cobro de cuenta corriente', () => {
  beforeEach(() => openShift());

  async function indebted(amount: string) {
    const client = await customer();
    await ownerQuery('UPDATE cliente SET saldo = $1 WHERE id = $2', [amount, client.id]);
    return client;
  }

  const collect = (id: string, metodoPagoId: string, monto: string, entregado?: string) =>
    post(`/clientes/${id}/cobros`, vo, {
      metodoPagoId,
      monto,
      claveIdempotencia: randomUUID(),
      ...(entregado === undefined ? {} : { entregado }),
    });

  it('en efectivo baja el saldo, sube el teórico del turno y emite un recibo', async () => {
    const client = await indebted('1000');
    const response = await collect(client.id, EFECTIVO, '400', '500');
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expectToMatchContract(response, 'post', '/clientes/{id}/cobros');
    expect(response.body).toMatchObject({
      estado: 'aplicado',
      vuelto: '100.00',
      saldoCliente: '600.00',
      recibo: { numero: 1, monto: '400.00' },
    });
    expect(await movements('cobro')).toEqual([{ monto: '400.00', en_efectivo: true }]);
    const own = await get('/caja/turno', vo);
    expect(JSON.stringify(own.body)).toContain('cobro');
  });

  it('un cobro de más se rechaza', async () => {
    const client = await indebted('300');
    const response = await collect(client.id, EFECTIVO, '300.01');
    expect(response.body).toMatchObject({ codigo: 'COBRO_EXCEDE_DEUDA' });
    expect(await balance(client.id)).toBe('300.00');
  });

  it('sin turno abierto no se puede cobrar', async () => {
    const client = await indebted('300');
    const response = await post(`/clientes/${client.id}/cobros`, voAs, {
      metodoPagoId: EFECTIVO,
      monto: '100',
      claveIdempotencia: randomUUID(),
    });
    expect(response.body).toMatchObject({ codigo: 'SIN_TURNO' });
  });

  it('con tarjeta se cobra el recargo, pero la deuda baja solo por lo imputado (D-85)', async () => {
    const client = await indebted('1000');
    const response = await collect(client.id, TARJETA, '500');
    expect(response.body).toMatchObject({
      estado: 'aplicado',
      recargo: '50.00',
      saldoCliente: '500.00',
    });
    expect(await movements('cobro')).toEqual([{ monto: '550.00', en_efectivo: false }]);
  });

  it('sin respuesta no baja el saldo ni hay recibo; al resolverse se aplica (D-85)', async () => {
    const client = await indebted('1000');
    await setMode('no_responder');
    const response = await collect(client.id, DEBITO, '700');
    const pending = response.body as AccountCollection;
    expect(pending).toMatchObject({
      estado: 'por_verificar',
      recibo: null,
      saldoCliente: '1000.00',
    });
    // Lo apartado no se puede volver a cobrar (RF-152).
    expect((await collect(client.id, EFECTIVO, '400')).body).toMatchObject({
      codigo: 'COBRO_EXCEDE_DEUDA',
    });
    const closing = await post('/caja/turno/corte-x', vo, { declarado: '1000' });
    expect(closing.status).toBe(409);

    await setMode('aprobar');
    await api.collections.verification.verify(TENANT_A, pending.pagoId);
    expect(await balance(client.id)).toBe('300.00');
    expect((await get('/cuenta-corriente/cobros', vo)).body).toEqual([]);
    expect(await ownerSelect('SELECT numero FROM recibo')).toEqual([{ numero: '1' }]);
  });

  it('sin respuesta y rechazado a mano con PIN, la deuda queda como estaba', async () => {
    const client = await indebted('1000');
    await setMode('no_responder');
    const pending = (await collect(client.id, DEBITO, '700')).body as AccountCollection;
    for (let i = 0; i < 3; i++) {
      await api.collections.verification.verify(TENANT_A, pending.pagoId);
    }
    const listed = await get('/cuenta-corriente/cobros', vo);
    expectToMatchContract(listed, 'get', '/cuenta-corriente/cobros');
    expect(listed.body).toMatchObject([{ resolucionManual: true }]);
    const autorizacionId = await pin('pago_por_verificar', `pago:${pending.pagoId}`);
    const resolved = await post(`/cuenta-corriente/cobros/${pending.id}/resolucion`, vo, {
      resultado: 'rechazado',
      autorizacionId,
    });
    expect(resolved.body).toMatchObject({ estado: 'rechazado', recibo: null });
    expect(await balance(client.id)).toBe('1000.00');
    expect((await collect(client.id, EFECTIVO, '1000')).status).toBe(201);
  });
});

describe('[RF-075] [RF-125] pagos electrónicos', () => {
  beforeEach(() => openShift());

  it('un rechazo conserva la venta, sus reservas y los pagos aprobados', async () => {
    const sale = await cart('2');
    await charge(sale.id, DEBITO, '1000');
    await setMode('rechazar');
    const second = await charge(sale.id, TARJETA, '1000');
    expect(second.status).toBe(201);
    expect((second.body as SalePaymentAttempt).pago.estado).toBe('rechazado');
    expect((second.body as SalePaymentAttempt).venta).toMatchObject({
      estado: 'en_curso',
      porCobrar: '1000.00',
    });
    expect(await stockReserved()).toBe('2.000');
    const paid = await post(`/ventas/${sale.id}/cobro`, vo, { entregado: '1000' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
  });

  it('con un pago aprobado el carrito queda bloqueado hasta revertirlo (D-85)', async () => {
    const sale = await cart();
    const attempt = (await charge(sale.id, DEBITO, '400')).body as SalePaymentAttempt;
    const blocked = await post(`/ventas/${sale.id}/items`, vo, {
      productoId: AGUA,
      cantidad: '1',
    });
    expect(blocked.body).toMatchObject({ codigo: 'CARRITO_BLOQUEADO' });
    expect((await put(`/ventas/${sale.id}/descuento`, vo, { descuento: null })).body).toMatchObject(
      { codigo: 'CARRITO_BLOQUEADO' },
    );

    const reversed = await post(`/ventas/${sale.id}/pagos/${attempt.pago.id}/reversion`, vo);
    expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
    expectToMatchContract(reversed, 'post', '/ventas/{id}/pagos/{pagoId}/reversion');
    expect((reversed.body as Cart).porCobrar).toBe('1000.00');
    const added = await post(`/ventas/${sale.id}/items`, vo, { productoId: AGUA, cantidad: '1' });
    expect(added.status).toBe(200);
  });

  it('el descarte se rechaza hasta revertir el pago aprobado', async () => {
    const sale = await cart();
    const attempt = (await charge(sale.id, DEBITO, '1000')).body as SalePaymentAttempt;
    const rejected = await post(`/ventas/${sale.id}/descarte`, vo);
    expect(rejected.body).toMatchObject({ codigo: 'PAGOS_POR_REVERTIR' });
    await post(`/ventas/${sale.id}/pagos/${attempt.pago.id}/reversion`, vo);
    expect((await post(`/ventas/${sale.id}/descarte`, vo)).status).toBe(204);
    expect(await stockReserved()).toBe('0.000');
  });

  it('si la pasarela no confirma la reversión, el pago sigue aprobado', async () => {
    const sale = await cart();
    const attempt = (await charge(sale.id, DEBITO, '1000')).body as SalePaymentAttempt;
    await setMode('no_responder');
    const failed = await post(`/ventas/${sale.id}/pagos/${attempt.pago.id}/reversion`, vo);
    expect(failed.body).toMatchObject({ codigo: 'REVERSION_FALLIDA' });
    const current = await get(`/ventas/${sale.id}`, vo);
    expect((current.body as Cart).pagos).toMatchObject([{ estado: 'aprobado' }]);
  });

  it('un carrito con pagos aprobados no vence por inactividad', async () => {
    const sale = await cart();
    await charge(sale.id, DEBITO, '500');
    api.clock.advance(60 * 60_000);
    await api.sales.maintenance.expireCart(TENANT_A, sale.id);
    expect(await stockReserved()).toBe('1.000');
  });

  it('repetir la clave de idempotencia no genera otro cobro', async () => {
    const sale = await cart();
    const body = { metodoPagoId: DEBITO, fraccion: '400', claveIdempotencia: randomUUID() };
    const first = await post(`/ventas/${sale.id}/pagos`, vo, body);
    const second = await post(`/ventas/${sale.id}/pagos`, vo, body);
    expect((second.body as SalePaymentAttempt).pago.id).toBe(
      (first.body as SalePaymentAttempt).pago.id,
    );
    expect((await ownerSelect('SELECT 1 FROM pago')).length).toBe(1);
  });
});

describe('[RF-126] [RF-127] pago por verificar', () => {
  beforeEach(() => openShift());

  async function uncertain() {
    const sale = await cart();
    await setMode('no_responder');
    const response = await charge(sale.id, DEBITO, '1000');
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return { sale, attempt: response.body as SalePaymentAttempt };
  }

  it('la venta queda por verificar, con reservas, y ese medio no se reintenta', async () => {
    const { sale, attempt } = await uncertain();
    expect(attempt.venta.estado).toBe('pago_por_verificar');
    expect(attempt.pago.estado).toBe('por_verificar');
    expect(await stockReserved()).toBe('1.000');
    const retry = await charge(sale.id, DEBITO, '1000');
    expect(retry.body).toMatchObject({ codigo: 'PAGO_POR_VERIFICAR' });
    const paid = await post(`/ventas/${sale.id}/cobro`, vo, {});
    expect(paid.body).toMatchObject({ codigo: 'PAGO_POR_VERIFICAR' });
    const discard = await post(`/ventas/${sale.id}/descarte`, vo);
    expect(discard.body).toMatchObject({ codigo: 'PAGO_POR_VERIFICAR' });
  });

  it('el worker lo resuelve cuando la pasarela vuelve a responder', async () => {
    const { sale, attempt } = await uncertain();
    await api.sales.verification.verify(TENANT_A, attempt.pago.id);
    expect(((await get(`/ventas/${sale.id}`, vo)).body as Cart).estado).toBe('pago_por_verificar');
    await setMode('aprobar');
    await api.sales.verification.verify(TENANT_A, attempt.pago.id);
    const current = (await get(`/ventas/${sale.id}`, vo)).body as Cart;
    expect(current).toMatchObject({ estado: 'en_curso', porCobrar: '0.00' });
    expect(current.pagos).toMatchObject([{ estado: 'aprobado' }]);
  });

  it('un AS lo resuelve a mano con PIN, solo después de agotar las consultas', async () => {
    const { sale, attempt } = await uncertain();
    const path = `/ventas/${sale.id}/pagos/${attempt.pago.id}/resolucion`;
    const autorizacionId = await pin('pago_por_verificar', `pago:${attempt.pago.id}`);
    const early = await post(path, vo, { resultado: 'aprobado', autorizacionId });
    expect(early.body).toMatchObject({ codigo: 'VERIFICACION_EN_CURSO' });

    await verifyTimes(attempt.pago.id);
    const shown = (await get(`/ventas/${sale.id}`, vo)).body as Cart;
    expect(shown.pagos).toMatchObject([{ resolucionManual: true }]);
    const resolved = await post(path, vo, { resultado: 'aprobado', autorizacionId });
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    expectToMatchContract(resolved, 'post', '/ventas/{id}/pagos/{pagoId}/resolucion');
    expect((await post(`/ventas/${sale.id}/cobro`, vo, { pagos: [] })).status).toBe(200);
  });

  it('quien pidió la operación no se autoriza a sí mismo', async () => {
    await openShift(voAs, CAJA_2);
    const sale = await cart('1', voAs);
    await setMode('no_responder');
    const attempt = (await charge(sale.id, DEBITO, '1000', voAs)).body as SalePaymentAttempt;
    const own = await post('/autorizaciones', voAs, {
      tipo: 'pago_por_verificar',
      operacionRef: `pago:${attempt.pago.id}`,
      sucursalId: BRANCH_CENTRO,
      autorizanteId: USERS.asVo.id,
      pin: PIN,
    });
    expect(own.status).not.toBe(201);
  });

  it('una aprobación tardía de una venta descartada alerta al AS y al AC', async () => {
    const sale = await cart();
    await setMode('aprobar_tarde');
    const attempt = (await charge(sale.id, DEBITO, '1000')).body as SalePaymentAttempt;
    await verifyTimes(attempt.pago.id);
    const autorizacionId = await pin('pago_por_verificar', `pago:${attempt.pago.id}`);
    await post(`/ventas/${sale.id}/pagos/${attempt.pago.id}/resolucion`, vo, {
      resultado: 'rechazado',
      autorizacionId,
    });
    expect((await post(`/ventas/${sale.id}/descarte`, vo)).status).toBe(204);

    api.clock.advance(5 * 60_000);
    await api.sales.verification.verify(TENANT_A, attempt.pago.id);
    const alerts = await ownerSelect<{ destinatario_rol: string; detalle: unknown }>(
      `SELECT destinatario_rol, detalle FROM alerta WHERE tipo = 'reintegro_pendiente'
        ORDER BY destinatario_rol`,
    );
    expect(alerts.map((a) => a.destinatario_rol)).toEqual(['AC', 'AS']);
    expect(alerts[0]?.detalle).toMatchObject({ monto: '1000.00', ventaId: sale.id });
    // No se repite en la próxima consulta.
    await api.sales.verification.verify(TENANT_A, attempt.pago.id);
    expect(
      (await ownerSelect("SELECT 1 FROM alerta WHERE tipo = 'reintegro_pendiente'")).length,
    ).toBe(2);
  });

  it('el worker termina un pago que quedó pendiente si el proceso cayó', async () => {
    const sale = await cart();
    const attempt = (await charge(sale.id, DEBITO, '1000')).body as SalePaymentAttempt;
    await ownerQuery("UPDATE pago SET estado = 'pendiente' WHERE id = $1", [attempt.pago.id]);
    await api.sales.verification.verify(TENANT_A, attempt.pago.id);
    const current = (await get(`/ventas/${sale.id}`, vo)).body as Cart;
    expect(current.pagos).toMatchObject([{ estado: 'aprobado' }]);
  });
});

describe('[RF-115] cierres con pagos vivos', () => {
  it('un cierre forzado no descarta una venta con un pago aprobado (D-86)', async () => {
    await openShift();
    const sale = await cart();
    await charge(sale.id, DEBITO, '500');
    const shifts = await ownerSelect<{ id: string }>('SELECT id FROM turno');
    const shift = shifts[0]?.id ?? '';
    const forced = await post(`/caja/turnos/${shift}/cierre-forzado`, as, { declarado: '1000' });
    expect(forced.status).toBe(409);
    expect(forced.body).toMatchObject({ codigo: 'PAGOS_POR_REVERTIR' });
    expect(await stockReserved()).toBe('1.000');
  });
});
