// Cuota de descuento: tope del AC, cuotas de los VO, saldo por fecha de jornada y descuentos
// fuera de cuota con autorización (T-123 a T-127; RF-063 a RF-067, RF-142, RF-152).
import type { BranchSellerQuotas, DiscountCapResult, SellerQuota } from '@pos/contracts';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { DiscountInput } from '../../src/modulos/cuota/aplicacion/quotas.js';
import { createTestApi } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { ownerQuery, ownerSelect } from '../support/database.js';
import {
  BRANCH_B,
  BRANCH_CENTRO,
  BRANCH_NORTE,
  PIN,
  seedIdentity,
  signIn,
  TENANT_A,
  USERS,
} from '../support/identity-fixtures.js';

const api = createTestApi();
afterAll(() => api.close());

const TODAY = '2026-11-02';

let ac: string;
let as: string;

beforeEach(async () => {
  await seedIdentity();
  ac = (await signIn(api.app, USERS.ac.email)).authorization;
  as = (await signIn(api.app, USERS.asVo.email, 'AS')).authorization;
});

const setCap = (porcentajeMaximo: string, montoMaximo: string, token = ac) =>
  request(api.app)
    .put('/cuota/tope')
    .set('Authorization', token)
    .send({ porcentajeMaximo, montoMaximo });

const setQuota = (
  porcentajeMaximo: string,
  monto: string,
  {
    seller = USERS.vo.id,
    branch = BRANCH_CENTRO,
    token = as,
  }: { seller?: string; branch?: string; token?: string } = {},
) =>
  request(api.app)
    .put(`/cuota/sucursales/${branch}/vendedores/${seller}`)
    .set('Authorization', token)
    .send({ porcentajeMaximo, monto });

const listQuotas = (branch: string = BRANCH_CENTRO, token = as) =>
  request(api.app).get(`/cuota/sucursales/${branch}/vendedores`).set('Authorization', token);

// El servicio que usarán turnos y ventas, cada llamada en su propia transacción.
const seller = (userId: string = USERS.vo.id) => ({
  tenantId: TENANT_A,
  userId,
  at: api.clock.now(),
});
const openDay = (journeyDate = TODAY) =>
  api.db.run(() => api.quotas.discounts.openDay(seller(), BRANCH_CENTRO, journeyDate), {
    tenantId: TENANT_A,
  });
const discount = (amount: string, subtotal = '10000.00', extra: Partial<DiscountInput> = {}) =>
  api.db.run(
    () =>
      api.quotas.discounts.applyDiscount(seller(), {
        branchId: BRANCH_CENTRO,
        journeyDate: TODAY,
        discount: { subtotal, amount, enteredPercent: null },
        ...extra,
      }),
    { tenantId: TENANT_A },
  );

const balanceRows = () =>
  ownerSelect<{ fecha_jornada: string; saldo: string }>(
    `SELECT fecha_jornada::text, saldo FROM saldo_cuota WHERE usuario_id = $1 ORDER BY fecha_jornada`,
    [USERS.vo.id],
  );

describe('[RF-063] [RF-142] tope de cuota del comercio', () => {
  it('sin tope fijado, los límites son cero', async () => {
    const response = await request(api.app).get('/cuota/tope').set('Authorization', ac);

    expect(response.status).toBe(200);
    expectToMatchContract(response, 'get', '/cuota/tope');
    expect(response.body).toEqual({ porcentajeMaximo: '0.0000', montoMaximo: '0.00' });
  });

  it('el AC fija el tope y queda en la auditoría', async () => {
    const response = await setCap('15', '5000');

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expectToMatchContract(response, 'put', '/cuota/tope');
    expect(response.body).toEqual({
      tope: { porcentajeMaximo: '15.0000', montoMaximo: '5000.00' },
      cuotasRecortadas: 0,
    });
    const audit = await ownerSelect<{ accion: string }>(
      "SELECT accion FROM auditoria_comercial WHERE entidad = 'tope_cuota'",
    );
    expect(audit).toEqual([{ accion: 'cuota_tope_modificado' }]);
  });

  it('un porcentaje mayor que 100 se rechaza', async () => {
    const response = await setCap('100.01', '5000');

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'CUOTA_INVALIDA' });
  });

  it('al bajar el tope, las cuotas mayores se recortan y el saldo del día baja por la diferencia', async () => {
    await setCap('20', '3000');
    await setQuota('20', '3000');
    await setQuota('5', '1000', { seller: USERS.pendiente.id });
    await openDay();
    await discount('500.00');

    const response = await setCap('10', '2000');

    expect(response.status).toBe(200);
    expect((response.body as DiscountCapResult).cuotasRecortadas).toBe(1);
    const quotas = await ownerSelect<{ usuario_id: string; pct_max_venta: string; monto: string }>(
      'SELECT usuario_id, pct_max_venta, monto FROM cuota_vo ORDER BY monto DESC',
    );
    expect(quotas).toEqual([
      { usuario_id: USERS.vo.id, pct_max_venta: '10.0000', monto: '2000.00' },
      { usuario_id: USERS.pendiente.id, pct_max_venta: '5.0000', monto: '1000.00' },
    ]);
    // Tenía 3000 y gastó 500 (saldo 2500); el monto bajó 1000.
    expect(await balanceRows()).toEqual([{ fecha_jornada: TODAY, saldo: '1500.00' }]);
    const audit = await ownerSelect<{ accion: string }>(
      "SELECT accion FROM auditoria_comercial WHERE accion = 'cuota_vo_recortada'",
    );
    expect(audit).toHaveLength(1);
  });

  it('el AS no fija el tope', async () => {
    expect((await setCap('10', '1000', as)).status).toBe(403);
  });
});

describe('[RF-064] cuotas de los VO', () => {
  beforeEach(async () => {
    await setCap('15', '5000');
  });

  it('el AS asigna una cuota dentro del tope y aparece en el listado', async () => {
    const response = await setQuota('10', '1500');

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expectToMatchContract(response, 'put', '/cuota/sucursales/{id}/vendedores/{usuarioId}');
    expect(response.body).toMatchObject({
      usuarioId: USERS.vo.id,
      porcentajeMaximo: '10.0000',
      monto: '1500.00',
      asignada: true,
      saldo: null,
    });

    const list = await listQuotas();
    expect(list.status).toBe(200);
    expectToMatchContract(list, 'get', '/cuota/sucursales/{id}/vendedores');
    const body = list.body as BranchSellerQuotas;
    expect(body.tope).toEqual({ porcentajeMaximo: '15.0000', montoMaximo: '5000.00' });
    expect(body.vendedores.map((v) => [v.usuarioId, v.asignada, v.monto])).toEqual(
      expect.arrayContaining([
        [USERS.vo.id, true, '1500.00'],
        [USERS.asVo.id, false, '0.00'],
      ]),
    );
    const audit = await ownerSelect<{ accion: string; sucursal_id: string }>(
      "SELECT accion, sucursal_id FROM auditoria_comercial WHERE entidad = 'cuota_vo'",
    );
    expect(audit).toEqual([{ accion: 'cuota_vo_asignada', sucursal_id: BRANCH_CENTRO }]);
  });

  it.each([
    ['15.0001', '100'],
    ['5', '5000.01'],
  ])('una cuota de %s %% y $ %s supera el tope y se rechaza', async (percent, amount) => {
    const response = await setQuota(percent, amount);

    expect(response.status).toBe(409);
    expectToMatchContract(response, 'put', '/cuota/sucursales/{id}/vendedores/{usuarioId}');
    expect(response.body).toMatchObject({ codigo: 'CUOTA_SUPERA_TOPE' });
  });

  it('solo se asigna a un VO activo de la sucursal', async () => {
    const response = await setQuota('5', '100', { seller: USERS.ac.id });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'VENDEDOR_INVALIDO' });
  });

  it('[D-74] el AS no se asigna su propia cuota', async () => {
    const response = await setQuota('5', '100', { seller: USERS.asVo.id });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ codigo: 'AUTOASIGNACION' });
  });

  it('[D-73] al cambiar el monto, el saldo del día se ajusta por la diferencia', async () => {
    await setQuota('10', '1000');
    await openDay();
    await discount('400.00');

    await setQuota('10', '1500');
    expect(await balanceRows()).toEqual([{ fecha_jornada: TODAY, saldo: '1100.00' }]);

    const lowered = await setQuota('10', '500');
    expect((lowered.body as SellerQuota).saldo).toEqual({ fechaJornada: TODAY, saldo: '100.00' });
  });

  it('el AS de otra sucursal no ve ni asigna cuotas de Centro; otro comercio no las encuentra', async () => {
    const norte = (await signIn(api.app, USERS.asNorte.email, 'AS')).authorization;
    expect((await listQuotas(BRANCH_CENTRO, norte)).status).toBe(403);
    expect((await setQuota('5', '100', { token: norte })).status).toBe(403);
    expect((await listQuotas(BRANCH_NORTE, norte)).status).toBe(200);

    const other = (await signIn(api.app, USERS.asB.email, 'AS')).authorization;
    expect((await listQuotas(BRANCH_CENTRO, other)).status).toBe(404);
    expect((await listQuotas(BRANCH_B, ac)).status).toBe(403);
  });
});

describe('[RF-065] [RF-067] saldo por fecha de jornada', () => {
  beforeEach(async () => {
    await setCap('10', '1000');
    await setQuota('10', '1000');
  });

  it('un descuento dentro de la cuota se aplica y descuenta el saldo', async () => {
    await openDay();

    expect(await discount('300.00')).toEqual({
      consumed: '300.00',
      balance: '700.00',
      authorizationId: null,
    });
  });

  it('dos turnos con la misma fecha de jornada no restablecen el saldo; una fecha nueva sí', async () => {
    expect(await openDay()).toBe('1000.00');
    await discount('600.00');

    // Segundo turno del mismo día (o de una jornada que pasó la medianoche).
    expect(await openDay()).toBe('400.00');

    expect(await openDay('2026-11-03')).toBe('1000.00');
    expect(await balanceRows()).toEqual([
      { fecha_jornada: TODAY, saldo: '400.00' },
      { fecha_jornada: '2026-11-03', saldo: '1000.00' },
    ]);
  });

  it('sobre el porcentaje o sin saldo se rechaza sin autorización', async () => {
    await openDay();
    await expect(discount('100.01', '1000.00')).rejects.toMatchObject({
      code: 'DESCUENTO_REQUIERE_AUTORIZACION',
    });
    await discount('900.00');
    await expect(discount('100.01')).rejects.toMatchObject({
      code: 'DESCUENTO_REQUIERE_AUTORIZACION',
      message: expect.stringContaining('supera tu saldo') as string,
    });
    expect(await balanceRows()).toEqual([{ fecha_jornada: TODAY, saldo: '100.00' }]);
  });

  it('[D-72] un VO sin cuota asignada necesita autorización para cualquier descuento', async () => {
    await expect(
      api.db.run(
        () =>
          api.quotas.discounts.applyDiscount(seller(USERS.pendiente.id), {
            branchId: BRANCH_CENTRO,
            journeyDate: TODAY,
            discount: { subtotal: '100.00', amount: '1.00', enteredPercent: null },
          }),
        { tenantId: TENANT_A },
      ),
    ).rejects.toMatchObject({ code: 'DESCUENTO_REQUIERE_AUTORIZACION' });
  });

  it('[RF-152] descuentos simultáneos nunca superan el saldo', async () => {
    for (let round = 0; round < 20; round++) {
      await ownerQuery('DELETE FROM saldo_cuota');
      await openDay();
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => discount('300.00')));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      expect(await balanceRows()).toEqual([{ fecha_jornada: TODAY, saldo: '100.00' }]);
    }
  });
});

describe('[RF-066] descuento fuera de cuota con autorización', () => {
  beforeEach(async () => {
    await setCap('10', '1000');
    await setQuota('10', '1000');
  });

  const authorize = async (operationRef: string, authorizerId: string = USERS.asVo.id) => {
    const vo = (await signIn(api.app, USERS.vo.email, 'VO')).authorization;
    const response = await request(api.app).post('/autorizaciones').set('Authorization', vo).send({
      tipo: 'descuento',
      operacionRef: operationRef,
      sucursalId: BRANCH_CENTRO,
      autorizanteId: authorizerId,
      pin: PIN,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as { id: string }).id;
  };

  it('con autorización se aplica, el saldo queda igual y queda en la auditoría', async () => {
    await openDay();
    const id = await authorize('venta-1');

    const result = await discount('2000.00', '10000.00', {
      authorization: { id, operationRef: 'venta-1' },
    });

    expect(result).toEqual({ consumed: '0.00', balance: '1000.00', authorizationId: id });
    expect(await balanceRows()).toEqual([{ fecha_jornada: TODAY, saldo: '1000.00' }]);
    const audit = await ownerSelect<{ accion: string; autorizacion_id: string }>(
      "SELECT accion, autorizacion_id FROM auditoria_comercial WHERE accion = 'descuento_fuera_de_cuota'",
    );
    expect(audit).toEqual([{ accion: 'descuento_fuera_de_cuota', autorizacion_id: id }]);
  });

  it('un AC presente también autoriza', async () => {
    const id = await authorize('venta-2', USERS.ac.id);

    expect(
      await discount('1500.00', '10000.00', { authorization: { id, operationRef: 'venta-2' } }),
    ).toMatchObject({ consumed: '0.00', authorizationId: id });
  });

  it('una autorización de otra operación o ya usada se rechaza', async () => {
    const id = await authorize('venta-3');

    await expect(
      discount('2000.00', '10000.00', { authorization: { id, operationRef: 'venta-otra' } }),
    ).rejects.toMatchObject({ code: 'AUTORIZACION_INVALIDA' });
    await discount('2000.00', '10000.00', { authorization: { id, operationRef: 'venta-3' } });
    await expect(
      discount('2000.00', '10000.00', { authorization: { id, operationRef: 'venta-3' } }),
    ).rejects.toMatchObject({ code: 'AUTORIZACION_INVALIDA' });
  });

  it('un descuento dentro de la cuota consume el saldo aunque traiga autorización', async () => {
    const id = await authorize('venta-4');

    expect(
      await discount('100.00', '10000.00', { authorization: { id, operationRef: 'venta-4' } }),
    ).toEqual({ consumed: '100.00', balance: '900.00', authorizationId: null });
  });
});
