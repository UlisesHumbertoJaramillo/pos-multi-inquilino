// Facturación fiscal: módulo opcional, política, decisión por venta, certificado cifrado, tipos y
// numeración, envío, contingencia con CAEA, rechazos, reenvío, plazos y facturación posterior
// (T-190 a T-205, T-209; RF-100 a RF-106, RF-155, RF-160 a RF-162, RF-164 a RF-168, RF-145).
import { readFileSync } from 'node:fs';
import type { Cart, Voucher, VoucherOverview } from '@pos/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PgOutboxDispatcher } from '../../src/compartido/adaptadores/outbox/pg-outbox-dispatcher.js';
import { createTestApi } from '../support/app.js';
import { createMemoryLogger } from '../support/logger.js';
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
const CLIENTE_RI = 'b0000000-0000-4000-8000-000000000001';

let vo: string;
let voAs: string;
let as: string;
let ac: string;

async function signAll() {
  vo = (await signIn(api.app, USERS.vo.email, 'VO')).authorization;
  voAs = (await signIn(api.app, USERS.asVo.email, 'VO')).authorization;
  as = (await signIn(api.app, USERS.asVo.email, 'AS')).authorization;
  ac = (await signIn(api.app, USERS.ac.email, 'AC')).authorization;
}

beforeEach(async () => {
  api.clock.set('2026-11-02T12:00:00Z');
  await seedIdentity();
  await ownerQuery(
    `INSERT INTO caja (id, tenant_id, sucursal_id, nombre, punto_venta_fiscal, creado_en) VALUES
       ($1, $3, $4, 'Caja 1', 1, now()), ($2, $3, $4, 'Caja 2', 2, now())`,
    [CAJA_1, CAJA_2, TENANT_A, BRANCH_CENTRO],
  );
  await ownerQuery(
    `INSERT INTO metodo_pago (id, tenant_id, nombre, tipo, recargo_pct, creado_en)
     VALUES ($1, $2, 'Efectivo', 'efectivo', 0, now())`,
    [EFECTIVO, TENANT_A],
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
  await ownerQuery('UPDATE sucursal SET lista_precio_activa_id = $1 WHERE id = $2', [
    LISTA,
    BRANCH_CENTRO,
  ]);
  await ownerQuery(
    `INSERT INTO inventario (id, tenant_id, sucursal_id, producto_id, disponible, actualizado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, 1000, now())`,
    [TENANT_A, BRANCH_CENTRO, AGUA],
  );
  await ownerQuery(
    `INSERT INTO cliente (id, tenant_id, razon_social, documento, condicion_fiscal, creado_en)
     VALUES ($1, $2, 'Mayorista SA', '30111111119', 'responsable_inscripto', now())`,
    [CLIENTE_RI, TENANT_A],
  );
  await signAll();
});

const post = (path: string, token: string, body: object = {}) =>
  request(api.app).post(path).set('Authorization', token).send(body);
const put = (path: string, token: string, body: object = {}) =>
  request(api.app).put(path).set('Authorization', token).send(body);
const get = (path: string, token: string) => request(api.app).get(path).set('Authorization', token);

async function enableModule(condition = 'responsable_inscripto', policy = 'siempre') {
  await ownerQuery('UPDATE comercio SET modulo_facturacion = true WHERE id = $1', [TENANT_A]);
  await ownerQuery(
    `INSERT INTO parametro_comercio (tenant_id, inactividad_carrito_min, inactividad_sesion_min,
       plazo_regularizacion_horas, plazo_devolucion_dias, tolerancia_arqueo, politica_facturacion,
       plazo_facturacion_posterior_dias, actualizado_en, actualizado_por)
     VALUES ($1, 15, 30, 72, 30, 0, $2, 1, now(), $3)
     ON CONFLICT (tenant_id) DO UPDATE SET politica_facturacion = EXCLUDED.politica_facturacion`,
    [TENANT_A, policy, USERS.ac.id],
  );
  await ownerQuery(
    `INSERT INTO credencial_fiscal (tenant_id, cuit, condicion_fiscal, certificado_cifrado,
       clave_cifrada, vence_en, cargado_por, cargado_en)
     VALUES ($1, '20123456789', $2, 'x', 'x', '2030-01-01', $3, now())
     ON CONFLICT (tenant_id) DO UPDATE SET condicion_fiscal = EXCLUDED.condicion_fiscal`,
    [TENANT_A, condition, USERS.ac.id],
  );
}

const setMode = async (modo: string) => {
  expect((await put('/simulador/fiscal', vo, { modo })).status).toBe(200);
};

async function openShift(token = vo, caja = CAJA_1) {
  const response = await post('/caja/turnos', token, { cajaId: caja, saldoInicial: '0' });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

async function cart(token = vo): Promise<Cart> {
  const started = await post('/ventas', token);
  const id = (started.body as Cart).id;
  const added = await post(`/ventas/${id}/items`, token, { productoId: AGUA, cantidad: '1' });
  expect(added.status, JSON.stringify(added.body)).toBe(200);
  return added.body as Cart;
}

// Confirma una venta y entrega su pedido de comprobante, como hace el worker.
async function sold(token = vo, body: object = {}, customer?: string) {
  const sale = await cart(token);
  if (customer !== undefined) {
    await put(`/ventas/${sale.id}/cliente`, token, { clienteId: customer });
  }
  const paid = await post(`/ventas/${sale.id}/cobro`, token, body);
  expect(paid.status, JSON.stringify(paid.body)).toBe(200);
  return sale.id;
}

// Entrega los pedidos de comprobante con el despachador real del worker: el pedido lo escribió la
// confirmación de la venta en el outbox, y tiene que quedar procesado sin errores.
const deliver = async (saleId: string) => {
  const dispatcher = new PgOutboxDispatcher(api.db, api.clock, createMemoryLogger(), {
    handlers: api.fiscal.eventHandlers,
  });
  while ((await dispatcher.dispatchOnce()) > 0) {
    // Hasta vaciar el outbox.
  }
  const pending = await ownerSelect<{ ultimo_error: string | null }>(
    `SELECT ultimo_error FROM outbox
      WHERE tipo_evento = 'comprobante.solicitado' AND procesado_en IS NULL`,
  );
  expect(pending).toEqual([]);
  expect(await ownerSelect('SELECT 1 FROM comprobante WHERE venta_id = $1', [saleId])).toHaveLength(
    1,
  );
};

const fiscalState = async (saleId: string) =>
  (
    await ownerSelect<{ estado_fiscal: string }>('SELECT estado_fiscal FROM venta WHERE id = $1', [
      saleId,
    ])
  )[0]?.estado_fiscal;

const voucherOf = async (saleId: string) =>
  (
    await ownerSelect<{
      id: string;
      clase: string;
      numero: string | null;
      estado: string;
      cae: string | null;
      contingencia: boolean;
      caea_codigo: string | null;
      no_fiscal: boolean;
    }>(
      `SELECT id, clase, numero, estado, cae, contingencia, caea_codigo, no_fiscal
         FROM comprobante WHERE venta_id = $1`,
      [saleId],
    )
  )[0];

const alerts = (type: string) =>
  ownerSelect<{ destinatario_rol: string; persistente: boolean; detalle: unknown }>(
    `SELECT destinatario_rol, persistente, detalle FROM alerta
      WHERE tipo = $1 AND resuelta_en IS NULL ORDER BY destinatario_rol`,
    [type],
  );

const seedCaea = () =>
  ownerQuery(
    `INSERT INTO caea (id, tenant_id, periodo, codigo, vigente_desde, vigente_hasta, obtenido_en)
     VALUES (gen_random_uuid(), $1, '2026111', 'CAEA1', '2026-11-01', '2026-11-15', now())`,
    [TENANT_A],
  );

describe('[RF-165] sin el módulo activo', () => {
  it('la sesión informa si el comercio tiene el módulo, para no mostrar funciones fiscales', async () => {
    const session = await get('/auth/sesion', ac);
    expectToMatchContract(session, 'get', '/auth/sesion');
    expect(session.body).toMatchObject({ moduloFacturacion: false });
  });

  it('la venta no se factura, no hay pedido fiscal y los endpoints se rechazan', async () => {
    await openShift();
    const sale = await sold();
    expect(await fiscalState(sale)).toBe('no_se_factura');
    expect(
      await ownerSelect("SELECT 1 FROM outbox WHERE tipo_evento = 'comprobante.solicitado'"),
    ).toEqual([]);
    const response = await get('/fiscal/comprobantes', as);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'MODULO_FISCAL_INACTIVO' });
    expect((await get('/fiscal/configuracion', ac)).status).toBe(409);
  });

  it('el POS no muestra la opción de facturar', async () => {
    await openShift();
    const sale = await cart();
    const option = await get(`/ventas/${sale.id}/facturacion`, vo);
    expectToMatchContract(option, 'get', '/ventas/{id}/facturacion');
    expect(option.body).toEqual({ visible: false, propuesta: false, obligatoria: false });
  });
});

describe('[RF-166] [RF-167] decisión de facturar', () => {
  beforeEach(() => openShift());

  it.each([
    ['siempre', null, true],
    ['siempre', false, true],
    ['opcional_con_factura', null, true],
    ['opcional_con_factura', false, false],
    ['opcional_sin_factura', null, false],
    ['opcional_sin_factura', true, true],
  ])('política %s con la decisión %s', async (policy, choice, expected) => {
    await enableModule('responsable_inscripto', policy);
    const sale = await sold(vo, choice === null ? {} : { facturar: choice });
    expect(await fiscalState(sale)).toBe(expected ? 'pendiente' : 'no_se_factura');
    const row = await ownerSelect<{ factura_decidida_por: string }>(
      'SELECT factura_decidida_por FROM venta WHERE id = $1',
      [sale],
    );
    expect(row[0]?.factura_decidida_por).toBe(USERS.vo.id);
  });

  it('un responsable inscripto fuerza la factura aunque el VO la desmarque', async () => {
    await enableModule('responsable_inscripto', 'opcional_sin_factura');
    const sale = await cart();
    await put(`/ventas/${sale.id}/cliente`, vo, { clienteId: CLIENTE_RI });
    expect((await get(`/ventas/${sale.id}/facturacion`, vo)).body).toEqual({
      visible: true,
      propuesta: true,
      obligatoria: true,
    });
    await post(`/ventas/${sale.id}/cobro`, vo, { facturar: false });
    expect(await fiscalState(sale.id)).toBe('pendiente');
  });

  it('con un emisor monotributista no hay factura A que forzar', async () => {
    await enableModule('monotributista', 'opcional_sin_factura');
    const sale = await sold(vo, {}, CLIENTE_RI);
    expect(await fiscalState(sale)).toBe('no_se_factura');
  });
});

describe('[RF-162] credencial fiscal', () => {
  // Certificado público de prueba: vence el 2036-11-03.
  const PEM = readFileSync(new URL('../support/certificado-prueba.crt', import.meta.url), 'utf8');

  it('se guarda cifrada, nunca se devuelve y un certificado que vence pronto alerta', async () => {
    await ownerQuery('UPDATE comercio SET modulo_facturacion = true WHERE id = $1', [TENANT_A]);
    api.clock.set('2036-10-19T12:00:00Z');
    await signAll();
    const saved = await put('/fiscal/credencial', ac, {
      cuit: '20-12345678-9',
      condicionFiscal: 'responsable_inscripto',
      certificado: PEM,
      clave: 'clave-de-prueba',
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expectToMatchContract(saved, 'put', '/fiscal/credencial');
    const shown = await get('/fiscal/configuracion', ac);
    expect(JSON.stringify(shown.body)).not.toContain('BEGIN');
    expect(shown.body).toMatchObject({ cuit: '20123456789' });

    const stored = await ownerSelect<{ certificado_cifrado: string; clave_cifrada: string }>(
      'SELECT certificado_cifrado, clave_cifrada FROM credencial_fiscal',
    );
    expect(stored[0]?.certificado_cifrado).not.toContain('BEGIN');
    expect(stored[0]?.clave_cifrada).not.toContain('clave-de-prueba');

    await api.fiscal.queue.sweep();
    expect(await alerts('certificado_por_vencer')).toHaveLength(1);
  });

  it('un certificado ilegible se rechaza y el AS no configura', async () => {
    await ownerQuery('UPDATE comercio SET modulo_facturacion = true WHERE id = $1', [TENANT_A]);
    const body = {
      cuit: '20123456789',
      condicionFiscal: 'exento',
      certificado: 'nada',
      clave: 'nada',
    };
    expect((await put('/fiscal/credencial', ac, body)).body).toMatchObject({
      codigo: 'CERTIFICADO_INVALIDO',
    });
    expect((await put('/fiscal/credencial', as, body)).status).toBe(403);
  });
});

describe('[RF-100] [RF-106] [RF-155] envío y numeración', () => {
  beforeEach(async () => {
    await enableModule();
    await openShift();
  });

  it('nunca figura emitida antes de la aceptación, y después tiene su CAE', async () => {
    const sale = await sold();
    expect(await fiscalState(sale)).toBe('pendiente');
    await deliver(sale);
    expect(await fiscalState(sale)).toBe('emitida');
    expect(await voucherOf(sale)).toMatchObject({ estado: 'aceptado', clase: 'B', numero: '1' });
    expect((await voucherOf(sale))?.cae).toMatch(/^SIM/);
  });

  it('entregar dos veces el pedido no duplica el comprobante', async () => {
    const sale = await sold();
    await deliver(sale);
    await api.fiscal.queue.request(TENANT_A, sale);
    expect(await ownerSelect('SELECT 1 FROM comprobante')).toHaveLength(1);
  });

  it('un responsable inscripto recibe A, y cada caja numera por separado', async () => {
    await openShift(voAs, CAJA_2);
    const first = await sold(vo);
    const second = await sold(voAs);
    const third = await sold(vo, {}, CLIENTE_RI);
    for (const sale of [first, second, third]) await deliver(sale);
    expect(await voucherOf(first)).toMatchObject({ clase: 'B', numero: '1' });
    expect(await voucherOf(second)).toMatchObject({ clase: 'B', numero: '1' });
    expect(await voucherOf(third)).toMatchObject({ clase: 'A', numero: '1' });
  });

  it('una caja sin punto de venta vende igual, alerta al AC y sale al asignarlo (D-87)', async () => {
    await ownerQuery('UPDATE caja SET punto_venta_fiscal = NULL WHERE id = $1', [CAJA_1]);
    const sale = await sold();
    await deliver(sale);
    expect(await voucherOf(sale)).toMatchObject({ estado: 'pendiente', numero: null });
    expect(await alerts('fiscal_sin_configurar')).toHaveLength(1);

    await ownerQuery('UPDATE caja SET punto_venta_fiscal = 7 WHERE id = $1', [CAJA_1]);
    api.clock.advance(5 * 60_000);
    await api.fiscal.queue.process(TENANT_A);
    expect(await voucherOf(sale)).toMatchObject({ estado: 'aceptado', numero: '1' });
    expect(await alerts('fiscal_sin_configurar')).toEqual([]);
  });
});

describe('[RF-160] [RF-101] [RF-102] [RF-161] contingencia', () => {
  beforeEach(async () => {
    await enableModule();
    await openShift();
  });

  it('el worker pide el CAEA de la quincena, y si falla alerta al AC', async () => {
    await setMode('caido');
    await api.fiscal.queue.sweep();
    expect(await alerts('caea_no_obtenido')).toMatchObject([{ destinatario_rol: 'AC' }]);
    await setMode('acepta');
    await api.fiscal.queue.sweep();
    expect(await ownerSelect('SELECT periodo FROM caea')).toEqual([{ periodo: '2026111' }]);
    expect(await alerts('caea_no_obtenido')).toEqual([]);
  });

  it('pide por adelantado el período siguiente', async () => {
    api.clock.set('2026-11-12T12:00:00Z');
    await api.fiscal.queue.sweep();
    expect(await ownerSelect('SELECT periodo FROM caea ORDER BY periodo')).toEqual([
      { periodo: '2026111' },
      { periodo: '2026112' },
    ]);
  });

  it('con el servicio caído emite con CAEA, y al volver informa la cola en orden', async () => {
    await seedCaea();
    await setMode('caido');
    const [a, b] = [await sold(), await sold()];
    await deliver(a);
    await deliver(b);
    expect(await fiscalState(a)).toBe('en_contingencia');
    expect(await voucherOf(a)).toMatchObject({ contingencia: true, caea_codigo: 'CAEA1' });

    await setMode('acepta');
    api.clock.advance(10 * 60_000);
    await api.fiscal.queue.process(TENANT_A);
    expect(await fiscalState(a)).toBe('emitida');
    expect(await fiscalState(b)).toBe('emitida');
    expect((await voucherOf(a))?.cae).toBeNull();
    const order = await ownerSelect<{ numero: string }>(
      `SELECT c.numero FROM intento_envio_fiscal i JOIN comprobante c ON c.id = i.comprobante_id
        WHERE i.resultado = 'aceptado' ORDER BY i.momento, c.numero`,
    );
    expect(order).toEqual([{ numero: '1' }, { numero: '2' }]);
  });

  it('un rechazo no frena al resto de la cola', async () => {
    await seedCaea();
    await setMode('caido');
    const [a, b] = [await sold(), await sold()];
    await deliver(a);
    await deliver(b);
    await setMode('rechaza');
    api.clock.advance(10 * 60_000);
    await api.fiscal.queue.process(TENANT_A);
    expect(await fiscalState(a)).toBe('rechazada');
    expect(await fiscalState(b)).toBe('rechazada');
    expect((await voucherOf(b))?.no_fiscal).toBe(false);
  });

  it('sin CAEA vigente: ticket no fiscal, sigue en cola y alerta al AC', async () => {
    await setMode('caido');
    const sale = await sold();
    await deliver(sale);
    expect(await voucherOf(sale)).toMatchObject({ estado: 'pendiente', no_fiscal: true });
    expect(await fiscalState(sale)).toBe('pendiente');
    expect(await alerts('fiscal_sin_caea')).toMatchObject([{ destinatario_rol: 'AC' }]);

    await setMode('acepta');
    api.clock.advance(10 * 60_000);
    await api.fiscal.queue.process(TENANT_A);
    expect(await fiscalState(sale)).toBe('emitida');
    expect((await voucherOf(sale))?.cae).toMatch(/^SIM/);
    expect(await alerts('fiscal_sin_caea')).toEqual([]);
  });
});

describe('[RF-103] [RF-104] [RF-105] rechazos, reenvío y plazos', () => {
  beforeEach(async () => {
    await enableModule();
    await openShift();
    await setMode('rechaza');
  });

  it('un rechazo en línea deja la venta válida, con ticket no fiscal y dos alertas', async () => {
    const sale = await sold();
    await deliver(sale);
    expect(await fiscalState(sale)).toBe('rechazada');
    const row = await ownerSelect<{ estado_comercial: string }>(
      'SELECT estado_comercial FROM venta WHERE id = $1',
      [sale],
    );
    expect(row).toEqual([{ estado_comercial: 'confirmada' }]);
    expect((await voucherOf(sale))?.no_fiscal).toBe(true);
    expect((await alerts('comprobante_rechazado')).map((a) => a.destinatario_rol)).toEqual([
      'AC',
      'AS',
    ]);
  });

  it('un AC o un AS lo reenvía con el dato corregido y queda en la auditoría', async () => {
    const sale = await sold(vo, {}, CLIENTE_RI);
    await deliver(sale);
    const listed = await get('/fiscal/comprobantes', as);
    expectToMatchContract(listed, 'get', '/fiscal/comprobantes');
    const voucher = (listed.body as VoucherOverview).comprobantes[0];
    if (!voucher) throw new Error('Falta el comprobante.');
    expect(voucher).toMatchObject({ estado: 'rechazado', clase: 'A' });
    expect((listed.body as VoucherOverview).alertas).toMatchObject([
      { tipo: 'comprobante_rechazado' },
    ]);

    // El dato se corrige en la ficha del cliente.
    await put(`/clientes/${CLIENTE_RI}`, as, {
      razonSocial: 'Mayorista SA',
      documento: '30111111119',
      condicionFiscal: 'exento',
    });
    await setMode('acepta');
    const resent = await post(`/fiscal/comprobantes/${voucher.id}/reenvio`, as);
    expect(resent.status, JSON.stringify(resent.body)).toBe(200);
    expectToMatchContract(resent, 'post', '/fiscal/comprobantes/{id}/reenvio');
    expect(resent.body as Voucher).toMatchObject({ estado: 'aceptado', clase: 'B' });
    expect(await fiscalState(sale)).toBe('emitida');
    expect(await alerts('comprobante_rechazado')).toEqual([]);
    expect(
      await ownerSelect("SELECT 1 FROM auditoria_comercial WHERE accion = 'comprobante_reenviado'"),
    ).toHaveLength(1);
  });

  it('solo se reenvía un comprobante rechazado', async () => {
    await setMode('acepta');
    const sale = await sold();
    await deliver(sale);
    const voucher = await voucherOf(sale);
    const response = await post(`/fiscal/comprobantes/${voucher?.id ?? ''}/reenvio`, as);
    expect(response.body).toMatchObject({ codigo: 'COMPROBANTE_NO_RECHAZADO' });
  });

  it('con el plazo vencido, la alerta es crítica, persistente y se repite', async () => {
    const sale = await sold();
    await deliver(sale);
    api.clock.advance(73 * 3_600_000);
    await api.fiscal.queue.sweep();
    expect(await alerts('fiscal_plazo_vencido')).toMatchObject([
      { destinatario_rol: 'AC', persistente: true, detalle: { recordatorios: 0 } },
    ]);
    api.clock.advance(25 * 3_600_000);
    await api.fiscal.queue.sweep();
    expect(await alerts('fiscal_plazo_vencido')).toMatchObject([{ detalle: { recordatorios: 1 } }]);
  });
});

describe('[RF-168] facturación posterior', () => {
  beforeEach(async () => {
    await enableModule('responsable_inscripto', 'opcional_sin_factura');
    await openShift();
  });

  const ticketOf = async (saleId: string) =>
    (
      await ownerSelect<{ numero_ticket: number }>(
        'SELECT numero_ticket FROM venta WHERE id = $1',
        [saleId],
      )
    )[0]?.numero_ticket;

  it('dentro del plazo se factura y queda en la auditoría', async () => {
    const sale = await sold();
    const response = await post('/fiscal/facturacion-posterior', as, {
      numeroTicket: await ticketOf(sale),
    });
    expect(response.status, JSON.stringify(response.body)).toBe(202);
    await deliver(sale);
    expect(await fiscalState(sale)).toBe('emitida');
    expect(
      await ownerSelect("SELECT 1 FROM auditoria_comercial WHERE accion = 'facturacion_posterior'"),
    ).toHaveLength(1);
  });

  it('fuera de plazo se rechaza, y una venta facturada no se factura dos veces', async () => {
    const sale = await sold();
    const numeroTicket = await ticketOf(sale);
    api.clock.advance(3 * 24 * 3_600_000);
    await signAll();
    const late = await post('/fiscal/facturacion-posterior', as, { numeroTicket });
    expect(late.body).toMatchObject({ codigo: 'PLAZO_FACTURACION_VENCIDO' });
    api.clock.set('2026-11-02T12:00:00Z');
    await signAll();
    await post('/fiscal/facturacion-posterior', as, { numeroTicket });
    const again = await post('/fiscal/facturacion-posterior', as, { numeroTicket });
    expect(again.body).toMatchObject({ codigo: 'VENTA_YA_FACTURADA' });
  });
});

describe('[RF-164] [RF-147] pendientes fiscales reales', () => {
  it('con un comprobante en cola no se puede desactivar el módulo', async () => {
    await enableModule();
    await openShift();
    await setMode('caido');
    await deliver(await sold());
    expect(await api.fiscal.queue.pendingFor(TENANT_A)).toEqual({
      queued: 1,
      rejected: 0,
      caeaNotReported: 0,
    });
    const sa = (await signIn(api.app, USERS.sa.email)).authorization;
    const response = await request(api.app)
      .put(`/plataforma/comercios/${TENANT_A}/modulo-facturacion`)
      .set('Authorization', sa)
      .send({ activo: false });
    expect(response.status).toBe(409);
  });
});

describe('[RF-145] bloqueo del PIN', () => {
  it('el sexto PIN erróneo genera la alerta al AC', async () => {
    await openShift();
    const body = {
      tipo: 'retiro',
      operacionRef: 'retiro:x:1',
      sucursalId: BRANCH_CENTRO,
      autorizanteId: USERS.asVo.id,
      pin: `${PIN}9`,
    };
    for (let i = 0; i < 6; i++) await post('/autorizaciones', vo, body);
    expect(await alerts('pin_bloqueado')).toMatchObject([{ destinatario_rol: 'AC' }]);
  });
});
