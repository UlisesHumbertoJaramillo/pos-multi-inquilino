// Caja: jornadas, turnos, movimientos, cortes X y Z ciegos, cierre forzado y alertas
// (T-129 a T-140; RF-089 a RF-099, RF-112, RF-115, RF-117, RF-118, RF-154, RF-067).
import type { CashShift, JourneyClosure, OwnShift, ShiftClosure } from '@pos/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { SaleInProgress } from '../../src/modulos/caja/aplicacion/ports.js';
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

// Ventas en curso simuladas hasta T-149.
let salesInProgress: SaleInProgress[] = [];
const discarded: string[] = [];
const api = createTestApi({
  salesInProgress: {
    forShift: () => Promise.resolve(salesInProgress),
    forRegister: () => Promise.resolve(salesInProgress),
    discardForShift: (_actor, shiftId) => {
      discarded.push(shiftId);
      return Promise.resolve();
    },
  },
});
afterAll(() => api.close());

const CAJA_1 = 'ab000000-0000-4000-8000-000000000001';
const CAJA_2 = 'ab000000-0000-4000-8000-000000000002';
const CAJA_NORTE = 'ab000000-0000-4000-8000-000000000003';
const TODAY = '2026-11-02';

let vo: string;
let voAs: string; // as@prueba.local con el rol VO (Centro)
let as: string; // as@prueba.local con el rol AS (Centro y Norte)
let ac: string;

beforeEach(async () => {
  salesInProgress = [];
  discarded.length = 0;
  api.clock.set('2026-11-02T12:00:00Z');
  await seedIdentity();
  await ownerQuery(
    `INSERT INTO caja (id, tenant_id, sucursal_id, nombre, creado_en) VALUES
       ($1, $4, $5, 'Caja 1', now()), ($2, $4, $5, 'Caja 2', now()), ($3, $4, $6, 'Caja Norte', now())`,
    [CAJA_1, CAJA_2, CAJA_NORTE, TENANT_A, BRANCH_CENTRO, BRANCH_NORTE],
  );
  vo = (await signIn(api.app, USERS.vo.email, 'VO')).authorization;
  voAs = (await signIn(api.app, USERS.asVo.email, 'VO')).authorization;
  as = (await signIn(api.app, USERS.asVo.email, 'AS')).authorization;
  ac = (await signIn(api.app, USERS.ac.email)).authorization;
});

const post = (path: string, token: string, body: object = {}) =>
  request(api.app).post(path).set('Authorization', token).send(body);
const get = (path: string, token: string) => request(api.app).get(path).set('Authorization', token);

const open = (token = vo, caja = CAJA_1, saldoInicial = '1000') =>
  post('/caja/turnos', token, { cajaId: caja, saldoInicial });
const cashIn = (monto: string, token = vo) =>
  post('/caja/turno/ingresos', token, { monto, motivo: 'Cambio' });
const corteX = (declarado: string, token = vo) => post('/caja/turno/corte-x', token, { declarado });
const corteZ = (declarado: string, token = vo, caja = CAJA_1) =>
  post(`/caja/cajas/${caja}/corte-z`, token, { declarado });

async function openedShift(token = vo, caja = CAJA_1, saldoInicial = '1000'): Promise<CashShift> {
  const response = await open(token, caja, saldoInicial);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as CashShift;
}

// El AS de la sucursal autoriza con su PIN, en la pantalla del VO.
async function authorizeWithdrawal(shiftId: string, monto: string, token = vo) {
  const response = await post('/autorizaciones', token, {
    tipo: 'retiro',
    operacionRef: `retiro:${shiftId}:${monto}`,
    sucursalId: BRANCH_CENTRO,
    autorizanteId: USERS.asVo.id,
    pin: PIN,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return (response.body as { id: string }).id;
}

const withdraw = async (shiftId: string, monto: string, authorizedAmount = monto) =>
  post('/caja/turno/retiros', vo, {
    monto,
    motivo: 'Depósito bancario',
    autorizacionId: await authorizeWithdrawal(shiftId, authorizedAmount),
  });

const alerts = (tipo: string) =>
  ownerSelect<{
    destinatario_rol: string;
    detalle: Record<string, unknown>;
    resuelta_en: Date | null;
  }>(
    'SELECT destinatario_rol, detalle, resuelta_en FROM alerta WHERE tipo = $1 ORDER BY destinatario_rol',
    [tipo],
  );

describe('[RF-090] [RF-154] un turno abierto por caja y por VO', () => {
  it('la base rechaza un segundo turno abierto en la misma caja', async () => {
    const shift = await openedShift();

    await expect(
      ownerQuery(
        `INSERT INTO turno (id, tenant_id, caja_id, sucursal_id, jornada_id, vendedor_id,
           saldo_inicial, abierto_en)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 0, now())`,
        [TENANT_A, CAJA_1, BRANCH_CENTRO, shift.jornadaId, USERS.asVo.id],
      ),
    ).rejects.toThrow(/turno_abierto_por_caja/);
  });

  it('otro VO no abre turno en una caja ocupada y un VO no abre dos turnos', async () => {
    await openedShift();

    const busy = await open(voAs);
    expect(busy.status).toBe(409);
    expectToMatchContract(busy, 'post', '/caja/turnos');
    expect(busy.body).toMatchObject({ codigo: 'CAJA_OCUPADA' });

    const second = await open(vo, CAJA_2);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ codigo: 'TURNO_YA_ABIERTO' });
  });

  it('[RF-152] aperturas simultáneas en una caja dejan un solo turno', async () => {
    for (let round = 0; round < 15; round++) {
      await ownerQuery('DELETE FROM turno');
      await ownerQuery('DELETE FROM jornada');
      const results = await Promise.all([open(vo), open(voAs)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const rows = await ownerSelect('SELECT id FROM turno');
      expect(rows).toHaveLength(1);
    }
  });
});

describe('[RF-118] [RF-097] apertura de turno y jornada', () => {
  it('el primer turno abre la jornada con la fecha de la zona horaria del comercio', async () => {
    // 02:00 UTC del 3 es 23:00 del 2 en Buenos Aires.
    api.clock.set('2026-11-03T02:00:00Z');
    vo = (await signIn(api.app, USERS.vo.email, 'VO')).authorization;
    const response = await open();

    expect(response.status).toBe(201);
    expectToMatchContract(response, 'post', '/caja/turnos');
    expect(response.body).toMatchObject({
      caja: 'Caja 1',
      vendedor: 'Vendedor',
      fechaJornada: '2026-11-02',
      saldoInicial: '1000.00',
      diferenciaInicial: null,
      estado: 'abierto',
    });
    const audit = await ownerSelect<{ accion: string }>(
      "SELECT accion FROM auditoria_comercial WHERE entidad = 'turno'",
    );
    expect(audit).toEqual([{ accion: 'turno_apertura' }]);
  });

  it('el segundo turno continúa la jornada y compara con lo declarado en el Corte X anterior', async () => {
    const first = await openedShift();
    await corteX('1000');

    const second = await openedShift(voAs, CAJA_1, '950');

    expect(second.jornadaId).toBe(first.jornadaId);
    expect(second.diferenciaInicial).toBe('-50.00');
    const alert = await alerts('diferencia_apertura');
    expect(alert).toHaveLength(1);
    expect(alert[0]).toMatchObject({
      destinatario_rol: 'AS',
      detalle: { declarado: '950.00', anterior: '1000.00', diferencia: '-50.00' },
    });
  });

  it('[D-77] una jornada de más de 24 h exige el Corte Z y alerta al AS una vez', async () => {
    await openedShift();
    await corteX('1000');
    api.clock.advance(24 * 3_600_000);
    voAs = (await signIn(api.app, USERS.asVo.email, 'VO')).authorization;
    as = (await signIn(api.app, USERS.asVo.email, 'AS')).authorization;

    const rejected = await open(voAs);
    expect(rejected.status).toBe(409);
    expect(rejected.body).toMatchObject({ codigo: 'JORNADA_SIN_CORTE_Z' });
    expect((await open(voAs)).status).toBe(409);
    const pending = await alerts('jornada_sin_z');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ destinatario_rol: 'AS', resuelta_en: null });

    const list = await get(`/caja/sucursales/${BRANCH_CENTRO}/cajas`, voAs);
    expectToMatchContract(list, 'get', '/caja/sucursales/{id}/cajas');
    expect(list.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: CAJA_1, requiereCorteZ: true })]),
    );

    expect((await corteZ('1000', as)).status).toBe(200);
    expect((await alerts('jornada_sin_z'))[0]?.resuelta_en).not.toBeNull();
    const next = await openedShift(voAs);
    expect(next.fechaJornada).toBe('2026-11-03');
  });
});

describe('[RF-067] restablecimiento de la cuota al abrir turno', () => {
  beforeEach(async () => {
    await ownerQuery(
      `INSERT INTO tope_cuota (tenant_id, pct_max_venta, monto_max, actualizado_en, actualizado_por)
       VALUES ($1, 10, 1000, now(), $2)`,
      [TENANT_A, USERS.ac.id],
    );
    await ownerQuery(
      `INSERT INTO cuota_vo (id, tenant_id, usuario_id, sucursal_id, pct_max_venta, monto,
         actualizado_en, actualizado_por)
       VALUES (gen_random_uuid(), $1, $2, $3, 10, 1000, now(), $4)`,
      [TENANT_A, USERS.vo.id, BRANCH_CENTRO, USERS.asVo.id],
    );
  });

  it('dos turnos con la misma fecha de jornada restablecen el saldo una sola vez', async () => {
    await openedShift();
    await api.db.run(
      () =>
        api.quotas.discounts.applyDiscount(
          { tenantId: TENANT_A, userId: USERS.vo.id, at: api.clock.now() },
          {
            branchId: BRANCH_CENTRO,
            journeyDate: TODAY,
            discount: { subtotal: '10000.00', amount: '400.00', enteredPercent: null },
          },
        ),
      { tenantId: TENANT_A },
    );
    await corteX('1000');
    await openedShift(vo, CAJA_2);

    const balances = await ownerSelect<{ fecha_jornada: string; saldo: string }>(
      'SELECT fecha_jornada::text, saldo FROM saldo_cuota WHERE usuario_id = $1',
      [USERS.vo.id],
    );
    expect(balances).toEqual([{ fecha_jornada: TODAY, saldo: '600.00' }]);
  });
});

describe('[RF-091] [RF-092] ingresos y retiros', () => {
  it('el VO registra un ingreso con motivo y queda en su turno, sin el teórico', async () => {
    const shift = await openedShift();

    const response = await cashIn('250.5');
    expect(response.status).toBe(201);
    expectToMatchContract(response, 'post', '/caja/turno/ingresos');

    const own = await get('/caja/turno', vo);
    expectToMatchContract(own, 'get', '/caja/turno');
    const body = own.body as OwnShift;
    expect(body.turno?.id).toBe(shift.id);
    expect(body.movimientos).toEqual([
      expect.objectContaining({ tipo: 'ingreso', monto: '250.50', motivo: 'Cambio' }),
    ]);
    expect(JSON.stringify(body)).not.toContain('teorico');

    expect((await post('/caja/turno/ingresos', vo, { monto: '10', motivo: ' ' })).status).toBe(409);
  });

  it('un retiro autorizado dentro del teórico se registra', async () => {
    const shift = await openedShift();
    await cashIn('500');

    const response = await withdraw(shift.id, '1500.00');

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expectToMatchContract(response, 'post', '/caja/turno/retiros');
    expect(response.body).toMatchObject({ tipo: 'retiro', monto: '1500.00' });
  });

  it('un retiro excesivo se rechaza: el VO recibe un mensaje genérico y el AS el motivo', async () => {
    const shift = await openedShift();

    const response = await withdraw(shift.id, '1000.01');

    expect(response.status).toBe(409);
    expectToMatchContract(response, 'post', '/caja/turno/retiros');
    expect(response.body).toMatchObject({ codigo: 'RETIRO_RECHAZADO' });
    expect(JSON.stringify(response.body)).not.toMatch(/1000|teórico|teorico/);
    const alert = await alerts('retiro_rechazado');
    expect(alert).toEqual([
      expect.objectContaining({
        destinatario_rol: 'AS',
        detalle: expect.objectContaining({
          monto: '1000.01',
          efectivoTeorico: '1000.00',
        }) as object,
      }),
    ]);
    const movements = await ownerSelect('SELECT id FROM movimiento_caja');
    expect(movements).toHaveLength(0);
  });

  it('una autorización por otro monto no sirve para el retiro', async () => {
    const shift = await openedShift();

    const response = await withdraw(shift.id, '900.00', '100.00');

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'AUTORIZACION_INVALIDA' });
  });
});

describe('[RF-094] [RF-099] [RF-117] Corte X ciego', () => {
  it.each([
    ['900', '-100.00', 'faltante'],
    ['1100', '100.00', 'sobrante'],
    ['1000', '0.00', 'cuadrado'],
  ])('declarando %s el arqueo es %s (%s)', async (declarado, diferencia, resultado) => {
    await openedShift(vo, CAJA_1, '800');
    await cashIn('200');

    const response = await corteX(declarado);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expectToMatchContract(response, 'post', '/caja/turno/corte-x');
    const body = response.body as ShiftClosure;
    // El VO solo recibe lo que declaró (D-80); el arqueo queda en el turno.
    expect(body.arqueo).toEqual({ declarado: `${declarado}.00` });
    expect(body.turno.estado).toBe('cerrado');
    const row = await ownerSelect<{ teorico: string; diferencia: string; resultado: string }>(
      'SELECT teorico, diferencia, resultado FROM turno',
    );
    expect(row).toEqual([{ teorico: '1000.00', diferencia, resultado }]);
    expect((await get('/caja/turno', vo)).body).toMatchObject({ turno: null });
  });

  it('un cierre confirmado no se puede modificar', async () => {
    await openedShift();
    await corteX('1000');

    await expect(
      api.db.run(() => api.db.query("UPDATE turno SET declarado = 5000 WHERE estado = 'cerrado'"), {
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(/no se puede modificar/);
    expect((await corteX('1000')).body).toMatchObject({ codigo: 'SIN_TURNO' });
  });

  it('con ventas en curso se rechaza indicando cuáles', async () => {
    await openedShift();
    salesInProgress = [{ id: 'v1', label: 'Ticket 15' }];

    const response = await corteX('1000');

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'VENTAS_EN_CURSO' });
    expect((response.body as { mensaje: string }).mensaje).toContain('Ticket 15');
  });
});

describe('[RF-095] [RF-096] Corte Z ciego', () => {
  it('con un turno abierto se rechaza indicando qué falta cerrar', async () => {
    await openedShift();

    const response = await corteZ('1000', as);

    expect(response.status).toBe(409);
    expectToMatchContract(response, 'post', '/caja/cajas/{id}/corte-z');
    expect(response.body).toMatchObject({ codigo: 'TURNOS_ABIERTOS' });
    expect((response.body as { mensaje: string }).mensaje).toContain('Vendedor');
  });

  it('consolida los turnos contra el teórico de toda la jornada y la cierra', async () => {
    await openedShift(vo, CAJA_1, '1000');
    await cashIn('500');
    await corteX('1450'); // faltante de 50 en el primer turno
    api.clock.advance(60_000);
    await openedShift(voAs, CAJA_1, '1450');
    await post('/caja/turno/ingresos', voAs, { monto: '100', motivo: 'Cambio' });
    await corteX('1550', voAs);

    const response = await corteZ('1550', vo);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expectToMatchContract(response, 'post', '/caja/cajas/{id}/corte-z');
    const body = response.body as JourneyClosure;
    // Teórico de la jornada: 1000 + 500 + 100 = 1600.
    expect(body).toMatchObject({
      caja: 'Caja 1',
      fechaJornada: TODAY,
      turnos: 2,
    });
    expect(body.arqueo).toEqual({ declarado: '1550.00' });
    const journeys = await ownerSelect<{
      estado: string;
      teorico_z: string;
      diferencia_z: string;
      resultado_z: string;
    }>('SELECT estado, teorico_z, diferencia_z, resultado_z FROM jornada');
    expect(journeys).toEqual([
      { estado: 'cerrada', teorico_z: '1600.00', diferencia_z: '-50.00', resultado_z: 'faltante' },
    ]);
    expect((await corteZ('1550', as)).body).toMatchObject({ codigo: 'SIN_JORNADA' });
  });

  it('para un AS la respuesta incluye el resultado, la diferencia y el teórico', async () => {
    await openedShift();
    await corteX('1000');

    const response = await corteZ('1000', as);

    expect((response.body as JourneyClosure).arqueo).toEqual({
      declarado: '1000.00',
      diferencia: '0.00',
      resultado: 'cuadrado',
      teorico: '1000.00',
    });
  });
});

describe('[RF-115] cierre forzado', () => {
  it('el AS cierra a ciegas el turno de un VO, queda forzado y se avisa al AC', async () => {
    const shift = await openedShift();

    const list = await get(`/caja/sucursales/${BRANCH_CENTRO}/turnos-abiertos`, as);
    expect(list.status).toBe(200);
    expectToMatchContract(list, 'get', '/caja/sucursales/{id}/turnos-abiertos');
    expect((list.body as CashShift[]).map((s) => s.id)).toEqual([shift.id]);

    const response = await post(`/caja/turnos/${shift.id}/cierre-forzado`, as, {
      declarado: '1000',
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expectToMatchContract(response, 'post', '/caja/turnos/{id}/cierre-forzado');
    expect(response.body).toMatchObject({
      turno: { forzado: true, vendedorId: USERS.vo.id },
      arqueo: { resultado: 'cuadrado', teorico: '1000.00' },
    });
    expect(discarded).toEqual([shift.id]);
    const row = await ownerSelect<{ cerrado_por: string; forzado: boolean }>(
      'SELECT cerrado_por, forzado FROM turno',
    );
    expect(row).toEqual([{ cerrado_por: USERS.asVo.id, forzado: true }]);
    expect(await alerts('cierre_forzado')).toEqual([
      expect.objectContaining({ destinatario_rol: 'AC' }),
    ]);
  });

  it('el AS no fuerza su propio turno y un VO no fuerza cierres', async () => {
    const own = await openedShift(voAs);
    const response = await post(`/caja/turnos/${own.id}/cierre-forzado`, as, { declarado: '0' });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'TURNO_PROPIO' });

    expect(
      (await post(`/caja/turnos/${own.id}/cierre-forzado`, vo, { declarado: '0' })).status,
    ).toBe(403);
  });

  it('el AS de otra sucursal no ve ni fuerza los turnos de Centro', async () => {
    const shift = await openedShift();
    const norte = (await signIn(api.app, USERS.asNorte.email, 'AS')).authorization;

    expect((await get(`/caja/sucursales/${BRANCH_CENTRO}/turnos-abiertos`, norte)).status).toBe(
      403,
    );
    expect(
      (await post(`/caja/turnos/${shift.id}/cierre-forzado`, norte, { declarado: '0' })).status,
    ).toBe(403);
  });
});

describe('[RF-098] arqueo fuera de tolerancia', () => {
  it('con tolerancia 0 cualquier diferencia avisa al AS y al AC', async () => {
    await openedShift();
    await corteX('999.99');

    expect((await alerts('arqueo_fuera_de_tolerancia')).map((a) => a.destinatario_rol)).toEqual([
      'AC',
      'AS',
    ]);
  });

  it('con tolerancia 100 una diferencia de 50 no avisa', async () => {
    await ownerQuery(
      `INSERT INTO parametro_comercio (tenant_id, inactividad_carrito_min, inactividad_sesion_min,
         plazo_regularizacion_horas, plazo_devolucion_dias, tolerancia_arqueo, politica_facturacion,
         plazo_facturacion_posterior_dias, actualizado_en, actualizado_por)
       VALUES ($1, 15, 30, 72, 30, 100, 'siempre', 0, now(), $2)`,
      [TENANT_A, USERS.ac.id],
    );
    await openedShift();
    await corteX('950');

    expect(await alerts('arqueo_fuera_de_tolerancia')).toHaveLength(0);
  });
});

describe('[RF-112] [RF-093] [D-80] ninguna respuesta para un VO incluye el teórico ni el arqueo', () => {
  it('recorre los endpoints de caja como VO', async () => {
    const bodies: unknown[] = [];
    const keep = (response: request.Response) => {
      bodies.push(response.body);
      return response;
    };
    const shift = (keep(await open()).body as CashShift).id;
    keep(await cashIn('300'));
    keep(await get('/caja/turno', vo));
    keep(await get(`/caja/sucursales/${BRANCH_CENTRO}/cajas`, vo));
    keep(await withdraw(shift, '200.00'));
    keep(await withdraw(shift, '5000.00'));
    keep(await corteX('1100'));
    keep(await corteZ('1100'));

    expect(bodies).toHaveLength(8);
    for (const body of bodies) {
      expect(JSON.stringify(body)).not.toMatch(/teorico|"diferencia"|"resultado"/);
    }
  });
});

describe('[RF-141] autorizantes para el modal de PIN', () => {
  it('lista a los AS de la sucursal y a los AC con PIN, sin el solicitante', async () => {
    const response = await get(`/autorizaciones/autorizantes?sucursalId=${BRANCH_CENTRO}`, vo);

    expect(response.status).toBe(200);
    expectToMatchContract(response, 'get', '/autorizaciones/autorizantes');
    expect(response.body).toEqual([
      { id: USERS.asVo.id, nombre: 'Admin Sucursal', rol: 'AS' },
      { id: USERS.ac.id, nombre: 'Admin Comercio', rol: 'AC' },
    ]);

    const self = await get(`/autorizaciones/autorizantes?sucursalId=${BRANCH_CENTRO}`, voAs);
    expect((self.body as { id: string }[]).map((a) => a.id)).toEqual([USERS.ac.id]);
    expect((await get(`/autorizaciones/autorizantes?sucursalId=${BRANCH_NORTE}`, vo)).status).toBe(
      403,
    );
  });
});

describe('[D-42] bajas con turnos abiertos', () => {
  it('no se da de baja una caja con un turno abierto', async () => {
    await openedShift();

    const response = await post(`/organizacion/cajas/${CAJA_1}/baja`, ac);

    expect(response.status).toBe(409);
    expect((response.body as { mensaje: string }).mensaje).toContain('turno');
  });
});
