// Ticket, informe diario por fecha de jornada, dashboards del AC y del AS y auditoría comercial
// (T-232 a T-236; RF-107, RF-109 a RF-111, RF-114, D-50, D-91).
import { randomUUID } from 'node:crypto';
import type { Cart } from '@pos/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerQuery } from '../support/database.js';
import {
  BRANCH_B,
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
const CAJA_NORTE = 'ab000000-0000-4000-8000-000000000003';
const BEBIDAS = 'a4000000-0000-4000-8000-000000000001';
const AGUA = 'a5000000-0000-4000-8000-000000000001';
const LISTA = 'a6000000-0000-4000-8000-000000000001';
const EFECTIVO = 'a3000000-0000-4000-8000-000000000001';
const TARJETA = 'a3000000-0000-4000-8000-000000000003';

let vo: string;
let voNorte: string;
let voB: string;
let ac: string;
let as: string;
let asNorte: string;
let acB: string;
let sa: string;

beforeEach(async () => {
  api.clock.set('2026-11-02T12:00:00Z');
  await seedIdentity();
  await ownerQuery(
    `INSERT INTO usuario_rol (id, usuario_id, rol, sucursal_id, creado_en)
     VALUES (gen_random_uuid(), $1, 'VO', $2, now())`,
    [USERS.asNorte.id, BRANCH_NORTE],
  );
  await ownerQuery(
    `INSERT INTO caja (id, tenant_id, sucursal_id, nombre, creado_en) VALUES
       ($1, $3, $4, 'Caja 1', now()), ($2, $3, $5, 'Caja Norte', now())`,
    [CAJA_1, CAJA_NORTE, TENANT_A, BRANCH_CENTRO, BRANCH_NORTE],
  );
  await ownerQuery(
    `INSERT INTO metodo_pago (id, tenant_id, nombre, tipo, recargo_pct, creado_en) VALUES
       ($1, $3, 'Efectivo', 'efectivo', 0, now()),
       ($2, $3, 'Tarjeta', 'electronico', 10, now())`,
    [EFECTIVO, TARJETA, TENANT_A],
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
     VALUES (gen_random_uuid(), $1, $2, $4, 100, now()), (gen_random_uuid(), $1, $3, $4, 100, now())`,
    [TENANT_A, BRANCH_CENTRO, BRANCH_NORTE, AGUA],
  );
  vo = (await signIn(api.app, USERS.vo.email, 'VO')).authorization;
  voNorte = (await signIn(api.app, USERS.asNorte.email, 'VO')).authorization;
  voB = (await signIn(api.app, USERS.voB.email, 'VO')).authorization;
  ac = (await signIn(api.app, USERS.ac.email, 'AC')).authorization;
  as = (await signIn(api.app, USERS.asVo.email, 'AS')).authorization;
  asNorte = (await signIn(api.app, USERS.asNorte.email, 'AS')).authorization;
  acB = (await signIn(api.app, USERS.acB.email, 'AC')).authorization;
  sa = (await signIn(api.app, USERS.sa.email)).authorization;
});

const post = (path: string, token: string, body: object = {}) =>
  request(api.app).post(path).set('Authorization', token).send(body);
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

async function sell(units: string, pay: object = {}, token = vo): Promise<Sold> {
  const started = await post('/ventas', token);
  const id = (started.body as Cart).id;
  const added = await post(`/ventas/${id}/items`, token, { productoId: AGUA, cantidad: units });
  expect(added.status, JSON.stringify(added.body)).toBe(200);
  const paid = await post(`/ventas/${id}/cobro`, token, pay);
  expect(paid.status, JSON.stringify(paid.body)).toBe(200);
  const body = paid.body as { numeroTicket: number; venta: Cart };
  return { id, ticket: body.numeroTicket, itemId: body.venta.items[0]?.id ?? '' };
}

// Venta con tarjeta (recargo del 10 %) pagada con la pasarela simulada.
async function sellByCard(units: string, token = vo): Promise<string> {
  const started = await post('/ventas', token);
  const id = (started.body as Cart).id;
  await post(`/ventas/${id}/items`, token, { productoId: AGUA, cantidad: units });
  const total = String(Number(units) * 1000);
  const charged = await post(`/ventas/${id}/pagos`, token, {
    metodoPagoId: TARJETA,
    fraccion: total,
    claveIdempotencia: randomUUID(),
  });
  expect(charged.status, JSON.stringify(charged.body)).toBe(201);
  const paid = await post(`/ventas/${id}/cobro`, token, {});
  expect(paid.status, JSON.stringify(paid.body)).toBe(200);
  return id;
}

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

async function voidSale(sale: Sold) {
  const autorizacionId = await pin('anulacion', `anulacion:${sale.id}`);
  const voided = await post(`/devoluciones/ventas/${sale.id}/anulacion`, vo, { autorizacionId });
  expect(voided.status, JSON.stringify(voided.body)).toBe(201);
}

async function giveBack(sale: Sold, cantidad: string) {
  const items = [{ itemId: sale.itemId, cantidad }];
  const quote = await post(`/devoluciones/ventas/${sale.id}/cotizacion`, vo, { items });
  const plan = quote.body as { requiereAutorizacion: boolean; operacionRef: string };
  const autorizacionId = plan.requiereAutorizacion
    ? await pin('reembolso', plan.operacionRef)
    : null;
  const done = await post(`/devoluciones/ventas/${sale.id}`, vo, { items, autorizacionId });
  expect(done.status, JSON.stringify(done.body)).toBe(201);
}

async function promotion() {
  const response = await post('/promociones', ac, {
    nombre: '10 % en agua',
    regla: { tipo: 'porcentaje', porcentaje: '10' },
    alcance: 'producto',
    objetivoId: AGUA,
    vigenteDesde: '2026-11-01T00:00:00Z',
    vigenteHasta: '2026-11-30T23:59:59Z',
    sucursales: null,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

describe('[RF-107] documento del ticket (T-232)', () => {
  it('una venta no facturada: ítems, promoción, pagos, totales y la leyenda', async () => {
    await promotion();
    await openShift();
    const sale = await sell('2', { entregado: '2000' });

    const response = await get(`/ventas/${sale.id}/ticket`, vo);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expectToMatchContract(response, 'get', '/ventas/{id}/ticket');
    expect(response.body).toMatchObject({
      numeroTicket: sale.ticket,
      estado: 'confirmada',
      comercio: { nombre: 'Comercio A' },
      sucursal: { nombre: 'Centro' },
      caja: 'Caja 1',
      items: [
        {
          nombre: 'Agua',
          cantidad: '2.000',
          precioUnitario: '1000.00',
          bruto: '2000.00',
          promocion: { nombre: '10 % en agua', descuento: '200.00' },
          importe: '1800.00',
        },
      ],
      pagos: [
        {
          metodo: 'Efectivo',
          tipo: 'efectivo',
          monto: '1800.00',
          abonado: '2000.00',
          vuelto: '200.00',
        },
      ],
      totales: {
        subtotal: '2000.00',
        descuentoPromociones: '200.00',
        total: '1800.00',
        recargos: '0.00',
        cobrado: '1800.00',
      },
      identificacion: 'no_valido_como_factura',
      leyenda: 'Ticket no válido como factura.',
      comprobante: null,
      impresion: { ancho: 48 },
    });
    // El documento a imprimir lo arma el backend (AD-16): el frontend solo lo envía.
    const lines = (response.body as { impresion: { lineas: { texto: string; estilo: string }[] } })
      .impresion.lineas;
    expect(lines[0]).toMatchObject({
      estilo: 'titulo',
      texto: expect.stringContaining('Comercio A') as string,
    });
    expect(lines.map((l) => l.texto)).toContainEqual(
      expect.stringMatching(/^TOTAL +\$ 1\.800,00$/),
    );
  });

  it('una venta facturada se identifica como comprobante fiscal o en trámite', async () => {
    await openShift();
    const sale = await sell('1');
    await ownerQuery(
      `UPDATE venta SET se_factura = true, estado_fiscal = 'emitida' WHERE id = $1`,
      [sale.id],
    );
    await ownerQuery(
      `INSERT INTO comprobante (id, tenant_id, tipo, clase, venta_id, sucursal_id, caja_id,
         punto_venta, numero, total, estado, cae, proximo_intento, plazo_vence, emitido_en)
       VALUES (gen_random_uuid(), $1, 'factura', 'B', $2, $3, $4, 1, 7, 1000, 'aceptado',
         '12345678901234', now(), now(), now())`,
      [TENANT_A, sale.id, BRANCH_CENTRO, CAJA_1],
    );
    const fiscal = await get(`/ventas/${sale.id}/ticket`, vo);
    expectToMatchContract(fiscal, 'get', '/ventas/{id}/ticket');
    expect(fiscal.body).toMatchObject({
      identificacion: 'comprobante_fiscal',
      comprobante: {
        tipo: 'factura',
        clase: 'B',
        puntoVenta: 1,
        numero: '7',
        cae: '12345678901234',
      },
    });

    await ownerQuery(
      `UPDATE comprobante SET estado = 'pendiente', cae = NULL WHERE venta_id = $1`,
      [sale.id],
    );
    expect((await get(`/ventas/${sale.id}/ticket`, vo)).body).toMatchObject({
      identificacion: 'factura_en_tramite',
    });
  });

  it('solo de una venta confirmada, de la sucursal del VO y de su comercio', async () => {
    await openShift();
    const sale = await sell('1');
    const cart = (await post('/ventas', vo)).body as Cart;
    expect((await get(`/ventas/${cart.id}/ticket`, vo)).body).toMatchObject({
      codigo: 'VENTA_SIN_TICKET',
    });
    expect((await get(`/ventas/${sale.id}/ticket`, voNorte)).status).toBe(403);
    expect((await get(`/ventas/${sale.id}/ticket`, voB)).status).toBe(404);
  });
});

describe('[RF-109] informe diario por fecha de jornada (T-233)', () => {
  it('una venta después de medianoche en una jornada abierta antes va a la fecha de la jornada', async () => {
    // 22:30 del 2 de noviembre en Buenos Aires.
    api.clock.set('2026-11-03T01:30:00Z');
    vo = (await signIn(api.app, USERS.vo.email, 'VO')).authorization;
    await openShift();
    // 01:00 del 3 de noviembre.
    api.clock.set('2026-11-03T04:00:00Z');
    // El reloj avanzó más que la inactividad de la sesión: se vuelve a ingresar.
    vo = (await signIn(api.app, USERS.vo.email, 'VO')).authorization;
    as = (await signIn(api.app, USERS.asVo.email, 'AS')).authorization;
    await sell('2', { entregado: '2000' });

    const day = await get(
      `/reportes/sucursales/${BRANCH_CENTRO}/informe-diario?fecha=2026-11-02`,
      as,
    );
    expect(day.status, JSON.stringify(day.body)).toBe(200);
    expectToMatchContract(day, 'get', '/reportes/sucursales/{id}/informe-diario');
    expect(day.body).toMatchObject({
      fechaJornada: '2026-11-02',
      ventas: { total: '2000.00', tickets: 1, promedio: '2000.00' },
    });
    const next = await get(
      `/reportes/sucursales/${BRANCH_CENTRO}/informe-diario?fecha=2026-11-03`,
      as,
    );
    expect(next.body).toMatchObject({ ventas: { total: '0.00', tickets: 0 } });
    // Sin fecha: la de hoy en la zona del comercio (3 de noviembre).
    expect(
      (await get(`/reportes/sucursales/${BRANCH_CENTRO}/informe-diario`, as)).body,
    ).toMatchObject({ fechaJornada: '2026-11-03' });
  });

  it('trae ventas por medio, vendedor y turno, devoluciones, anulaciones y arqueos', async () => {
    await openShift();
    const kept = await sell('3');
    const voided = await sell('1');
    await sellByCard('2');
    await voidSale(voided);
    await giveBack(kept, '1');
    // Teórico: 1000 + 3000 + 1000 - 1000 (anulación) - 1000 (devolución) = 3000.
    const closed = await post('/caja/turno/corte-x', vo, { declarado: '2900' });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);

    const response = await get(
      `/reportes/sucursales/${BRANCH_CENTRO}/informe-diario?fecha=2026-11-02`,
      ac,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expectToMatchContract(response, 'get', '/reportes/sucursales/{id}/informe-diario');
    expect(response.body).toMatchObject({
      sucursal: { id: BRANCH_CENTRO, nombre: 'Centro' },
      // Brutas: la anulada cuenta en las ventas y aparte en las anulaciones (D-91).
      ventas: { total: '6000.00', tickets: 3, promedio: '2000.00' },
      porMedio: [
        { metodo: 'Efectivo', tipo: 'efectivo', monto: '4000.00', recargo: '0.00' },
        { metodo: 'Tarjeta', tipo: 'electronico', monto: '2000.00', recargo: '200.00' },
      ],
      porVendedor: [{ vendedorId: USERS.vo.id, tickets: 3, total: '6000.00' }],
      porTurno: [
        {
          caja: 'Caja 1',
          tickets: 3,
          total: '6000.00',
          resultado: 'faltante',
          diferencia: '-100.00',
        },
      ],
      devoluciones: { cantidad: 1, valor: '1000.00', reintegro: '1000.00' },
      anulaciones: { cantidad: 1, total: '1000.00', reintegro: '1000.00' },
      arqueos: [{ tipo: 'turno', caja: 'Caja 1', resultado: 'faltante', diferencia: '-100.00' }],
      // Sin el módulo de facturación no hay comprobantes.
      comprobantesSinRegularizar: null,
    });
  });

  it('el AS de otra sucursal no ve el informe; una sucursal de otro comercio no existe', async () => {
    expect(
      (await get(`/reportes/sucursales/${BRANCH_CENTRO}/informe-diario`, asNorte)).status,
    ).toBe(403);
    expect((await get(`/reportes/sucursales/${BRANCH_B}/informe-diario`, ac)).status).toBe(404);
    expect(
      (await get(`/reportes/sucursales/${BRANCH_CENTRO}/informe-diario?fecha=2026-02-30`, as)).body,
    ).toMatchObject({ codigo: 'FECHA_INVALIDA' });
  });
});

describe('[RF-110] [RF-186] dashboard del AC (T-234)', () => {
  it('las métricas coinciden con lo vendido y se filtran por sucursal y período', async () => {
    await openShift();
    const kept = await sell('3');
    const voided = await sell('1');
    await sellByCard('2');
    await voidSale(voided);
    await giveBack(kept, '1');
    await openShift(voNorte, CAJA_NORTE);
    await sell('1', {}, voNorte);
    await ownerQuery(
      'UPDATE inventario SET umbral_minimo = 200 WHERE sucursal_id = $1 AND producto_id = $2',
      [BRANCH_NORTE, AGUA],
    );
    await ownerQuery(
      `INSERT INTO alerta (id, tenant_id, destinatario_rol, tipo, severidad, detalle, creada_en)
       VALUES (gen_random_uuid(), $1, 'AC', 'pin_bloqueado', 'advertencia', '{}', now())`,
      [TENANT_A],
    );

    const all = await get('/reportes/dashboard?desde=2026-11-01&hasta=2026-11-02', ac);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expectToMatchContract(all, 'get', '/reportes/dashboard');
    expect(all.body).toMatchObject({
      desde: '2026-11-01',
      hasta: '2026-11-02',
      sucursalId: null,
      ventas: { total: '7000.00', tickets: 4, promedio: '1750.00' },
      devoluciones: { cantidad: 1, valor: '1000.00' },
      anulaciones: { cantidad: 1, total: '1000.00' },
      porMedio: [
        { metodo: 'Efectivo', monto: '5000.00' },
        { metodo: 'Tarjeta', monto: '2000.00', recargo: '200.00' },
      ],
      porProducto: [{ productoId: AGUA, nombre: 'Agua', cantidad: '7.000', total: '7000.00' }],
      porDia: [{ fecha: '2026-11-02', total: '7000.00', tickets: 4 }],
      bajoMinimo: [{ sucursal: 'Norte', producto: 'Agua', umbral: '200.000' }],
      comprobantesSinRegularizar: null,
      alertas: { criticas: 0, advertencias: 1, informativas: 0 },
    });
    expect((all.body as { porVendedor: unknown[] }).porVendedor).toHaveLength(2);
    // [RF-186] Primer nivel: comparación con el período anterior, serie completa y lo destacado.
    expect(all.body).toMatchObject({
      anterior: { desde: '2026-10-30', hasta: '2026-10-31', ventas: { total: '0.00', tickets: 0 } },
      variacion: { total: null, tickets: null, promedio: null },
      serieDiaria: [
        { fecha: '2026-11-01', total: '0.00', tickets: 0 },
        { fecha: '2026-11-02', total: '7000.00', tickets: 4 },
      ],
      masVendidos: [{ productoId: AGUA, nombre: 'Agua', total: '7000.00' }],
      atencion: { bajoMinimo: 1, comprobantesSinRegularizar: null },
    });

    const norte = await get(`/reportes/dashboard?sucursalId=${BRANCH_NORTE}`, ac);
    expect(norte.body).toMatchObject({
      // Sin período: los últimos 30 días hasta hoy.
      desde: '2026-10-04',
      hasta: '2026-11-02',
      sucursalId: BRANCH_NORTE,
      ventas: { total: '1000.00', tickets: 1 },
      devoluciones: { cantidad: 0 },
    });
    const before = await get('/reportes/dashboard?desde=2026-10-01&hasta=2026-10-31', ac);
    expect(before.body).toMatchObject({ ventas: { total: '0.00', tickets: 0, promedio: '0.00' } });
  });

  it('el AC de otro comercio no ve nada y el período tiene límites', async () => {
    await openShift();
    await sell('1');
    expect((await get('/reportes/dashboard', acB)).body).toMatchObject({
      ventas: { total: '0.00', tickets: 0 },
    });
    expect((await get(`/reportes/dashboard?sucursalId=${BRANCH_CENTRO}`, acB)).status).toBe(404);
    expect(
      (await get('/reportes/dashboard?desde=2026-11-02&hasta=2026-11-01', ac)).body,
    ).toMatchObject({ codigo: 'PERIODO_INVALIDO' });
    expect(
      (await get('/reportes/dashboard?desde=2025-01-01&hasta=2026-11-01', ac)).body,
    ).toMatchObject({ codigo: 'PERIODO_DEMASIADO_LARGO' });
  });
});

describe('[RF-111] dashboard del AS (T-235)', () => {
  it('el AS de la sucursal 1 no ve datos de la sucursal 2', async () => {
    await openShift();
    await sell('2');
    const own = await get(`/reportes/sucursales/${BRANCH_NORTE}/dashboard`, asNorte);
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expectToMatchContract(own, 'get', '/reportes/sucursales/{id}/dashboard');
    expect(own.body).toMatchObject({ sucursalId: BRANCH_NORTE, ventas: { tickets: 0 } });
    expect((await get(`/reportes/sucursales/${BRANCH_CENTRO}/dashboard`, asNorte)).status).toBe(
      403,
    );
    expect((await get('/reportes/dashboard', asNorte)).status).toBe(403);
    expect((await get(`/reportes/sucursales/${BRANCH_CENTRO}/dashboard`, as)).body).toMatchObject({
      ventas: { total: '2000.00', tickets: 1 },
    });
  });
});

describe('[RF-114] consulta de la auditoría comercial (T-236)', () => {
  async function entry(
    branch: string | null,
    action: string,
    tenant: string = TENANT_A,
    user: string = USERS.ac.id,
  ) {
    await ownerQuery(
      `INSERT INTO auditoria_comercial (id, tenant_id, sucursal_id, usuario_id, rol_activo, momento,
         accion, entidad, entidad_id, estado_posterior)
       VALUES (gen_random_uuid(), $1, $2, $3, 'AC', '2026-11-02T11:00:00Z', $4, 'producto', 'x',
         '{"nombre":"Agua"}')`,
      [tenant, branch, user, action],
    );
  }

  it('el AC ve todo su comercio y el AS solo sus sucursales', async () => {
    await entry(null, 'producto_creado');
    await entry(BRANCH_CENTRO, 'ajuste_centro');
    await entry(BRANCH_NORTE, 'ajuste_norte');
    await entry(BRANCH_B, 'ajuste_otro', TENANT_B, USERS.acB.id);

    const all = await get('/auditoria-comercial', ac);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expectToMatchContract(all, 'get', '/auditoria-comercial');
    const actions = (body: unknown) =>
      (body as { entradas: { accion: string }[] }).entradas.map((e) => e.accion).sort();
    expect(actions(all.body)).toEqual(['ajuste_centro', 'ajuste_norte', 'producto_creado']);
    expect(all.body).toMatchObject({ hayMas: false });

    expect(actions((await get('/auditoria-comercial', asNorte)).body)).toEqual(['ajuste_norte']);
    expect(
      actions((await get(`/auditoria-comercial?sucursalId=${BRANCH_CENTRO}`, ac)).body),
    ).toEqual(['ajuste_centro']);
    expect((await get(`/auditoria-comercial?sucursalId=${BRANCH_CENTRO}`, asNorte)).status).toBe(
      403,
    );
    expect(actions((await get('/auditoria-comercial', acB)).body)).toEqual(['ajuste_otro']);
  });

  it('el SA recibe un rechazo', async () => {
    const response = await get('/auditoria-comercial', sa);
    expect(response.status).toBe(403);
  });

  it('pagina y filtra por acción y período', async () => {
    for (let i = 0; i < 3; i++) await entry(null, 'producto_creado');
    await entry(null, 'precio_cambiado');
    const page = await get('/auditoria-comercial?tamano=2&accion=producto_creado', ac);
    expect(page.body).toMatchObject({ hayMas: true });
    expect((page.body as { entradas: unknown[] }).entradas).toHaveLength(2);
    const last = await get('/auditoria-comercial?tamano=2&pagina=2&accion=producto_creado', ac);
    expect(last.body).toMatchObject({ hayMas: false });
    expect((last.body as { entradas: unknown[] }).entradas).toHaveLength(1);
    const outside = await get(
      '/auditoria-comercial?desde=2026-10-01T00:00:00Z&hasta=2026-10-31T00:00:00Z',
      ac,
    );
    expect((outside.body as { entradas: unknown[] }).entradas).toEqual([]);
  });
});
