// Devoluciones y anulaciones: anulación dentro del turno, ticket desde otra sucursal, plazo y
// cantidad, reintegro proporcional, efectivo insuficiente, ventas a crédito, Nota de Crédito,
// cuota, módulo inactivo y concurrencia (T-214 a T-224; RF-081 a RF-087, RF-136 a RF-140,
// RF-152, RF-169).
import { randomUUID } from 'node:crypto';
import type { Cart } from '@pos/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PgOutboxDispatcher } from '../../src/compartido/adaptadores/outbox/pg-outbox-dispatcher.js';
import { createTestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerQuery, ownerSelect } from '../support/database.js';
import {
  BRANCH_CENTRO,
  BRANCH_NORTE,
  PIN,
  seedIdentity,
  signIn,
  TENANT_A,
  USERS,
} from '../support/identity-fixtures.js';
import { createMemoryLogger } from '../support/logger.js';

const api = createTestApi();
afterAll(() => api.close());

const CAJA_1 = 'ab000000-0000-4000-8000-000000000001';
const CAJA_2 = 'ab000000-0000-4000-8000-000000000002';
const CAJA_NORTE = 'ab000000-0000-4000-8000-000000000003';
const BEBIDAS = 'a4000000-0000-4000-8000-000000000001';
const AGUA = 'a5000000-0000-4000-8000-000000000001';
const LISTA = 'a6000000-0000-4000-8000-000000000001';
const EFECTIVO = 'a3000000-0000-4000-8000-000000000001';
const TARJETA = 'a3000000-0000-4000-8000-000000000003';
const CUENTA = 'a3000000-0000-4000-8000-000000000004';
const CLIENTE = 'b0000000-0000-4000-8000-000000000001';

let vo: string;
let voAs: string;
let voNorte: string;
let voB: string;

async function signAll() {
  vo = (await signIn(api.app, USERS.vo.email, 'VO')).authorization;
  voAs = (await signIn(api.app, USERS.asVo.email, 'VO')).authorization;
  voNorte = (await signIn(api.app, USERS.asNorte.email, 'VO')).authorization;
  voB = (await signIn(api.app, USERS.voB.email, 'VO')).authorization;
}

beforeEach(async () => {
  api.clock.set('2026-11-02T12:00:00Z');
  await seedIdentity();
  await ownerQuery(
    `INSERT INTO usuario_rol (id, usuario_id, rol, sucursal_id, creado_en)
     VALUES (gen_random_uuid(), $1, 'VO', $2, now())`,
    [USERS.asNorte.id, BRANCH_NORTE],
  );
  await ownerQuery(
    `INSERT INTO caja (id, tenant_id, sucursal_id, nombre, punto_venta_fiscal, creado_en) VALUES
       ($1, $4, $5, 'Caja 1', 1, now()), ($2, $4, $5, 'Caja 2', 2, now()),
       ($3, $4, $6, 'Caja Norte', 3, now())`,
    [CAJA_1, CAJA_2, CAJA_NORTE, TENANT_A, BRANCH_CENTRO, BRANCH_NORTE],
  );
  await ownerQuery(
    `INSERT INTO metodo_pago (id, tenant_id, nombre, tipo, recargo_pct, creado_en) VALUES
       ($1, $4, 'Efectivo', 'efectivo', 0, now()),
       ($2, $4, 'Tarjeta', 'electronico', 10, now()),
       ($3, $4, 'Cuenta corriente', 'cuenta_corriente', 0, now())`,
    [EFECTIVO, TARJETA, CUENTA, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO categoria (id, tenant_id, nombre, tasa_iva, creado_en)
     VALUES ($1, $2, 'Bebidas', 21, now())`,
    [BEBIDAS, TENANT_A],
  );
  await ownerQuery(
    `INSERT INTO producto (id, tenant_id, tipo, nombre, categoria_id, costo, creado_en)
     VALUES ($1, $2, 'simple', 'Agua', $3, 100, now())`,
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
  await ownerQuery('UPDATE sucursal SET lista_precio_activa_id = $1 WHERE tenant_id = $2', [
    LISTA,
    TENANT_A,
  ]);
  await ownerQuery(
    `INSERT INTO inventario (id, tenant_id, sucursal_id, producto_id, disponible, actualizado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, 100, now())`,
    [TENANT_A, BRANCH_CENTRO, AGUA],
  );
  await ownerQuery(
    `INSERT INTO cliente (id, tenant_id, razon_social, condicion_fiscal, tiene_cuenta_corriente,
       limite_credito, creado_en)
     VALUES ($1, $2, 'Kiosco', 'consumidor_final', true, 100000, now())`,
    [CLIENTE, TENANT_A],
  );
  await signAll();
});

const post = (path: string, token: string, body: object = {}) =>
  request(api.app).post(path).set('Authorization', token).send(body);
const put = (path: string, token: string, body: object = {}) =>
  request(api.app).put(path).set('Authorization', token).send(body);
const get = (path: string, token: string) => request(api.app).get(path).set('Authorization', token);

async function openShift(token = vo, caja = CAJA_1, initial = '1000') {
  const response = await post('/caja/turnos', token, { cajaId: caja, saldoInicial: initial });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return (response.body as { id: string }).id;
}

interface Sold {
  id: string;
  ticket: number;
  itemId: string;
}

async function sell(units: string, pay: object = {}, token = vo, customer?: string): Promise<Sold> {
  const started = await post('/ventas', token);
  const id = (started.body as Cart).id;
  const added = await post(`/ventas/${id}/items`, token, { productoId: AGUA, cantidad: units });
  expect(added.status, JSON.stringify(added.body)).toBe(200);
  if (customer !== undefined) await put(`/ventas/${id}/cliente`, token, { clienteId: customer });
  const paid = await post(`/ventas/${id}/cobro`, token, pay);
  expect(paid.status, JSON.stringify(paid.body)).toBe(200);
  const body = paid.body as { numeroTicket: number; venta: Cart };
  return { id, ticket: body.numeroTicket, itemId: body.venta.items[0]?.id ?? '' };
}

async function pin(type: string, operacionRef: string, token = vo, branch = BRANCH_CENTRO) {
  const response = await post('/autorizaciones', token, {
    tipo: type,
    operacionRef,
    sucursalId: branch,
    autorizanteId: token === voAs ? USERS.ac.id : USERS.asVo.id,
    pin: PIN,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return (response.body as { id: string }).id;
}

const stock = async (branch = BRANCH_CENTRO) =>
  (
    await ownerSelect<{ disponible: string; en_revision: string }>(
      'SELECT disponible, en_revision FROM inventario WHERE sucursal_id = $1 AND producto_id = $2',
      [branch, AGUA],
    )
  )[0];

const cashOnHand = (shiftId: string) =>
  api.db.run(() => api.cash.sales.cashOnHand(TENANT_A, shiftId), { tenantId: TENANT_A });

const returnItems = (sale: Sold, cantidad: string) => [{ itemId: sale.itemId, cantidad }];

// Devuelve con el PIN que pida la cotización.
async function giveBack(sale: Sold, cantidad: string, token = vo, branch = BRANCH_CENTRO) {
  const items = returnItems(sale, cantidad);
  const quote = await post(`/devoluciones/ventas/${sale.id}/cotizacion`, token, { items });
  expect(quote.status, JSON.stringify(quote.body)).toBe(200);
  const plan = quote.body as { requiereAutorizacion: boolean; operacionRef: string };
  const autorizacionId = plan.requiereAutorizacion
    ? await pin('reembolso', plan.operacionRef, token, branch)
    : null;
  return post(`/devoluciones/ventas/${sale.id}`, token, { items, autorizacionId });
}

describe('[RF-081] [RF-082] anulación total dentro del turno', () => {
  it('devuelve el stock al disponible y el teórico del turno vuelve a su valor', async () => {
    const shift = await openShift();
    const before = await cashOnHand(shift);
    const sale = await sell('2');
    expect(await cashOnHand(shift)).toBe('3000.00');

    const withoutPin = await post(`/devoluciones/ventas/${sale.id}/anulacion`, vo, {});
    expect(withoutPin.body).toMatchObject({ codigo: 'ANULACION_REQUIERE_AUTORIZACION' });
    const autorizacionId = await pin('anulacion', `anulacion:${sale.id}`);
    const voided = await post(`/devoluciones/ventas/${sale.id}/anulacion`, vo, { autorizacionId });
    expect(voided.status, JSON.stringify(voided.body)).toBe(201);
    expectToMatchContract(voided, 'post', '/devoluciones/ventas/{id}/anulacion');

    expect(await stock()).toMatchObject({ disponible: '100.000' });
    expect(await cashOnHand(shift)).toBe(before);
    expect(
      await ownerSelect('SELECT estado_comercial FROM venta WHERE id = $1', [sale.id]),
    ).toEqual([{ estado_comercial: 'anulada' }]);
    const audit = await ownerSelect<{ autorizacion_id: string }>(
      "SELECT autorizacion_id FROM auditoria_comercial WHERE accion = 'venta_anulada'",
    );
    expect(audit).toEqual([{ autorizacion_id: autorizacionId }]);
  });

  it('una venta a crédito ya pagada se anula con el excedente en efectivo (D-89)', async () => {
    const shift = await openShift();
    const sale = await sell(
      '1',
      { pagos: [{ metodoPagoId: CUENTA, fraccion: '1000' }] },
      vo,
      CLIENTE,
    );
    await ownerQuery('UPDATE cliente SET saldo = 300 WHERE id = $1', [CLIENTE]);
    const before = await cashOnHand(shift);
    const autorizacionId = await pin('anulacion', `anulacion:${sale.id}`);
    const voided = await post(`/devoluciones/ventas/${sale.id}/anulacion`, vo, { autorizacionId });
    expect(voided.status, JSON.stringify(voided.body)).toBe(201);
    expect(await ownerSelect('SELECT saldo FROM cliente')).toEqual([{ saldo: '0.00' }]);
    expect(Number(before) - Number(await cashOnHand(shift))).toBe(700);
  });
});

describe('[RF-136] anulaciones que corresponden a una devolución', () => {
  it('se rechaza fuera de su turno, parcial o con devoluciones previas', async () => {
    await openShift();
    await openShift(voAs, CAJA_2);
    const sale = await sell('2');
    const autorizacionId = await pin('anulacion', `anulacion:${sale.id}`, voAs);

    const otherShift = await post(`/devoluciones/ventas/${sale.id}/anulacion`, voAs, {
      autorizacionId,
    });
    expect(otherShift.body).toMatchObject({ codigo: 'CORRESPONDE_DEVOLUCION' });
    expect((otherShift.body as { mensaje: string }).mensaje).toContain('devolución');

    const partial = await post(`/devoluciones/ventas/${sale.id}/anulacion`, vo, {
      autorizacionId,
      items: returnItems(sale, '1'),
    });
    expect(partial.body).toMatchObject({ codigo: 'CORRESPONDE_DEVOLUCION' });

    expect((await giveBack(sale, '1')).status).toBe(201);
    const afterReturn = await post(`/devoluciones/ventas/${sale.id}/anulacion`, vo, {
      autorizacionId,
    });
    expect(afterReturn.body).toMatchObject({ codigo: 'CORRESPONDE_DEVOLUCION' });
  });
});

describe('[RF-083] ticket desde cualquier sucursal', () => {
  it('un VO de Norte ve un ticket de Centro y otro comercio recibe 404', async () => {
    await openShift();
    await openShift(voNorte, CAJA_NORTE);
    const sale = await sell('3');
    const found = await get(`/devoluciones/tickets/${String(sale.ticket)}`, voNorte);
    expect(found.status, JSON.stringify(found.body)).toBe(200);
    expectToMatchContract(found, 'get', '/devoluciones/tickets/{numero}');
    expect(found.body).toMatchObject({
      sucursal: 'Centro',
      anulable: false,
      items: [{ cantidad: '3.000', devolvible: '3.000' }],
    });
    expect((await get(`/devoluciones/tickets/${String(sale.ticket)}`, voB)).status).toBe(404);
  });
});

describe('[RF-084] [RF-138] plazo y cantidad', () => {
  beforeEach(async () => {
    await openShift();
  });

  it('no se devuelve más de lo vendido', async () => {
    const sale = await sell('2');
    expect((await giveBack(sale, '1.5')).status).toBe(201);
    const excess = await post(`/devoluciones/ventas/${sale.id}/cotizacion`, vo, {
      items: returnItems(sale, '1'),
    });
    expect(excess.body).toMatchObject({ codigo: 'DEVOLUCION_EXCEDIDA' });
  });

  it('fuera del plazo se rechaza', async () => {
    const sale = await sell('1');
    await ownerQuery('UPDATE jornada SET fecha_jornada = fecha_jornada - 31');
    const late = await post(`/devoluciones/ventas/${sale.id}/cotizacion`, vo, {
      items: returnItems(sale, '1'),
    });
    expect(late.body).toMatchObject({ codigo: 'PLAZO_DEVOLUCION_VENCIDO' });
  });
});

describe('[RF-085] [RF-087] [RF-137] confirmación de la devolución', () => {
  it('reintegra en proporción a cada medio y deja el ítem en revisión donde se recibe', async () => {
    await openShift();
    const shiftNorte = await openShift(voNorte, CAJA_NORTE);
    const started = await post('/ventas', vo);
    const id = (started.body as Cart).id;
    await post(`/ventas/${id}/items`, vo, { productoId: AGUA, cantidad: '2' });
    await post(`/ventas/${id}/pagos`, vo, {
      metodoPagoId: TARJETA,
      fraccion: '1000',
      claveIdempotencia: randomUUID(),
    });
    const paid = await post(`/ventas/${id}/cobro`, vo, {});
    const body = paid.body as { venta: Cart };
    const sale = { id, ticket: 0, itemId: body.venta.items[0]?.id ?? '' };

    const quote = await post(`/devoluciones/ventas/${id}/cotizacion`, voNorte, {
      items: returnItems(sale, '1'),
    });
    expectToMatchContract(quote, 'post', '/devoluciones/ventas/{id}/cotizacion');
    // Mitad de lo cobrado con cada medio: 500 en efectivo y 550 con la tarjeta (recargo incluido).
    expect(quote.body).toMatchObject({
      valor: '1000.00',
      reintegro: '1050.00',
      efectivo: '500.00',
    });

    const before = await cashOnHand(shiftNorte);
    const done = await giveBack(sale, '1', voNorte, BRANCH_NORTE);
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expectToMatchContract(done, 'post', '/devoluciones/ventas/{id}');
    expect(Number(before) - Number(await cashOnHand(shiftNorte))).toBe(500);
    expect(await stock(BRANCH_NORTE)).toMatchObject({ en_revision: '1.000' });
    expect(await stock()).toMatchObject({ disponible: '98.000' });
  });

  it('sin efectivo suficiente se rechaza y solo el AS recibe el motivo', async () => {
    await openShift();
    await openShift(voNorte, CAJA_NORTE, '100');
    const sale = await sell('1');
    const response = await giveBack(sale, '1', voNorte, BRANCH_NORTE);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'REINTEGRO_RECHAZADO' });
    expect(JSON.stringify(response.body)).not.toContain('100.00');
    const alerts = await ownerSelect<{ destinatario_rol: string }>(
      "SELECT destinatario_rol FROM alerta WHERE tipo = 'reintegro_rechazado'",
    );
    expect(alerts).toEqual([{ destinatario_rol: 'AS' }]);
    expect(await ownerSelect('SELECT cantidad_devuelta FROM venta_item')).toEqual([
      { cantidad_devuelta: '0.000' },
    ]);
  });

  it('si la pasarela no confirma el reintegro, no se registra y el stock no se mueve', async () => {
    await openShift();
    const started = await post('/ventas', vo);
    const id = (started.body as Cart).id;
    await post(`/ventas/${id}/items`, vo, { productoId: AGUA, cantidad: '1' });
    await post(`/ventas/${id}/pagos`, vo, {
      metodoPagoId: TARJETA,
      fraccion: '1000',
      claveIdempotencia: randomUUID(),
    });
    const paid = await post(`/ventas/${id}/cobro`, vo, { pagos: [] });
    const sale = { id, ticket: 0, itemId: (paid.body as { venta: Cart }).venta.items[0]?.id ?? '' };
    await put('/simulador/pasarela', vo, { modo: 'rechazar' });
    const response = await giveBack(sale, '1');
    expect(response.body).toMatchObject({ codigo: 'REINTEGRO_ELECTRONICO_FALLIDO' });
    expect(await stock()).toMatchObject({ en_revision: '0.000' });
    expect(await ownerSelect('SELECT estado FROM devolucion')).toEqual([{ estado: 'rechazada' }]);
    expect(await ownerSelect('SELECT cantidad_devuelta FROM venta_item')).toEqual([
      { cantidad_devuelta: '0.000' },
    ]);
  });
});

describe('[RF-086] devolución de una venta a crédito', () => {
  it('baja el saldo hasta cero y el excedente en efectivo exige PIN', async () => {
    await openShift();
    const sale = await sell(
      '1',
      { pagos: [{ metodoPagoId: CUENTA, fraccion: '1000' }] },
      vo,
      CLIENTE,
    );
    await ownerQuery('UPDATE cliente SET saldo = 400 WHERE id = $1', [CLIENTE]);
    const quote = await post(`/devoluciones/ventas/${sale.id}/cotizacion`, vo, {
      items: returnItems(sale, '1'),
    });
    expect(quote.body).toMatchObject({
      cuentaCorriente: '400.00',
      efectivo: '600.00',
      requiereAutorizacion: true,
    });
    const without = await post(`/devoluciones/ventas/${sale.id}`, vo, {
      items: returnItems(sale, '1'),
    });
    expect(without.body).toMatchObject({ codigo: 'REEMBOLSO_REQUIERE_AUTORIZACION' });
    expect((await giveBack(sale, '1')).status).toBe(201);
    expect(await ownerSelect('SELECT saldo FROM cliente')).toEqual([{ saldo: '0.00' }]);
  });

  it('si el saldo cubre todo, no hace falta PIN', async () => {
    await openShift();
    const sale = await sell(
      '1',
      { pagos: [{ metodoPagoId: CUENTA, fraccion: '1000' }] },
      vo,
      CLIENTE,
    );
    const quote = await post(`/devoluciones/ventas/${sale.id}/cotizacion`, vo, {
      items: returnItems(sale, '1'),
    });
    expect(quote.body).toMatchObject({ efectivo: '0.00', requiereAutorizacion: false });
    expect((await giveBack(sale, '1')).status).toBe(201);
    expect(await ownerSelect('SELECT saldo FROM cliente')).toEqual([{ saldo: '0.00' }]);
  });
});

describe('[RF-140] cuota de descuento', () => {
  it('el saldo de la cuota no cambia al devolver una venta con descuento manual', async () => {
    await openShift();
    await ownerQuery(
      `INSERT INTO tope_cuota (tenant_id, pct_max_venta, monto_max, actualizado_en, actualizado_por)
       VALUES ($1, 50, 5000, now(), $2) ON CONFLICT (tenant_id) DO NOTHING`,
      [TENANT_A, USERS.ac.id],
    );
    const started = await post('/ventas', vo);
    const id = (started.body as Cart).id;
    await post(`/ventas/${id}/items`, vo, { productoId: AGUA, cantidad: '1' });
    const discount = await put(`/ventas/${id}/descuento`, vo, {
      descuento: { tipo: 'monto', valor: '100' },
    });
    if (discount.status !== 200) {
      const autorizacionId = await pin('descuento', `descuento:${id}`);
      await put(`/ventas/${id}/descuento`, vo, {
        descuento: { tipo: 'monto', valor: '100' },
        autorizacionId,
      });
    }
    const paid = await post(`/ventas/${id}/cobro`, vo, {});
    const sale = { id, ticket: 0, itemId: (paid.body as { venta: Cart }).venta.items[0]?.id ?? '' };
    const before = await ownerSelect('SELECT saldo FROM saldo_cuota');
    expect((await giveBack(sale, '1')).status).toBe(201);
    expect(await ownerSelect('SELECT saldo FROM saldo_cuota')).toEqual(before);
  });
});

describe('[RF-169] [RF-139] [RF-087] facturación', () => {
  async function enableModule() {
    await ownerQuery('UPDATE comercio SET modulo_facturacion = true WHERE id = $1', [TENANT_A]);
    await ownerQuery(
      `INSERT INTO credencial_fiscal (tenant_id, cuit, condicion_fiscal, certificado_cifrado,
         clave_cifrada, vence_en, cargado_por, cargado_en)
       VALUES ($1, '20123456789', 'responsable_inscripto', 'x', 'x', '2030-01-01', $2, now())`,
      [TENANT_A, USERS.ac.id],
    );
  }

  const dispatch = async () => {
    const dispatcher = new PgOutboxDispatcher(api.db, api.clock, createMemoryLogger(), {
      handlers: api.fiscal.eventHandlers,
    });
    while ((await dispatcher.dispatchOnce()) > 0) {
      // Hasta vaciar el outbox.
    }
    expect(await ownerSelect('SELECT ultimo_error FROM outbox WHERE procesado_en IS NULL')).toEqual(
      [],
    );
  };

  const vouchers = () =>
    ownerSelect<{ tipo: string; estado: string; clase: string | null; numero: string | null }>(
      'SELECT tipo, estado, clase, numero FROM comprobante ORDER BY tipo',
    );

  it('una venta facturada no se devuelve con el módulo inactivo; una sin factura sí', async () => {
    await enableModule();
    await openShift();
    const billed = await sell('1');
    await ownerQuery('UPDATE comercio SET modulo_facturacion = false WHERE id = $1', [TENANT_A]);
    const unbilled = await sell('1');
    const rejected = await post(`/devoluciones/ventas/${billed.id}/cotizacion`, vo, {
      items: returnItems(billed, '1'),
    });
    expect(rejected.body).toMatchObject({ codigo: 'MODULO_FISCAL_INACTIVO' });
    expect((await giveBack(unbilled, '1')).status).toBe(201);
  });

  it('la Nota de Crédito espera a su original y se bloquea si el original está rechazado', async () => {
    await enableModule();
    await openShift();
    await put('/simulador/fiscal', vo, { modo: 'rechaza' });
    const sale = await sell('2');
    await dispatch();
    expect((await giveBack(sale, '1')).status).toBe(201);
    await dispatch();
    expect(await vouchers()).toMatchObject([
      { tipo: 'factura', estado: 'rechazado' },
      { tipo: 'nota_credito', estado: 'bloqueado', numero: null },
    ]);

    // Al aceptarse el original, la Nota de Crédito vuelve a la cola y sale con su propia serie.
    await put('/simulador/fiscal', vo, { modo: 'acepta' });
    const as = (await signIn(api.app, USERS.asVo.email, 'AS')).authorization;
    const original = await ownerSelect<{ id: string }>(
      "SELECT id FROM comprobante WHERE tipo = 'factura'",
    );
    await post(`/fiscal/comprobantes/${original[0]?.id ?? ''}/reenvio`, as);
    api.clock.advance(60_000);
    await api.fiscal.queue.process(TENANT_A);
    expect(await vouchers()).toMatchObject([
      { tipo: 'factura', estado: 'aceptado', clase: 'B', numero: '1' },
      { tipo: 'nota_credito', estado: 'aceptado', clase: 'B', numero: '1' },
    ]);
  });

  it('una anulación de una venta facturada pide su Nota de Crédito', async () => {
    await enableModule();
    await openShift();
    const sale = await sell('1');
    await dispatch();
    const autorizacionId = await pin('anulacion', `anulacion:${sale.id}`);
    await post(`/devoluciones/ventas/${sale.id}/anulacion`, vo, { autorizacionId });
    await dispatch();
    expect(await vouchers()).toMatchObject([
      { tipo: 'factura', estado: 'aceptado' },
      { tipo: 'nota_credito', estado: 'aceptado' },
    ]);
  });
});

describe('[RF-152] dos devoluciones simultáneas del mismo ticket', () => {
  it('nunca se devuelve más de lo vendido (20 repeticiones)', async () => {
    await openShift();
    await openShift(voAs, CAJA_2, '100000');
    await ownerQuery('UPDATE turno SET saldo_inicial = 100000');
    for (let round = 0; round < 20; round++) {
      const sale = await sell('1');
      const items = returnItems(sale, '1');
      const quote = await post(`/devoluciones/ventas/${sale.id}/cotizacion`, vo, { items });
      const ref = (quote.body as { operacionRef: string }).operacionRef;
      const [a, b] = [await pin('reembolso', ref), await pin('reembolso', ref, voAs)];
      const results = await Promise.all([
        post(`/devoluciones/ventas/${sale.id}`, vo, { items, autorizacionId: a }),
        post(`/devoluciones/ventas/${sale.id}`, voAs, { items, autorizacionId: b }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const item = await ownerSelect<{ cantidad_devuelta: string }>(
        'SELECT cantidad_devuelta FROM venta_item WHERE id = $1',
        [sale.itemId],
      );
      expect(item).toEqual([{ cantidad_devuelta: '1.000' }]);
    }
  });
});
