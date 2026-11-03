import { describe, expect, it } from 'vitest';
import { normalizeSurcharge } from './payment-methods.js';
import { applyParameterChanges, DEFAULT_PARAMETERS } from './parameters.js';
import { assertNoDependencies, assertPointOfSale, NO_DEPENDENCIES } from './structure.js';

describe('[RF-135] parámetros del comercio', () => {
  it('acepta valores dentro de los márgenes de la plataforma', () => {
    const next = applyParameterChanges(
      DEFAULT_PARAMETERS,
      { cartIdleMinutes: 20, returnWindowDays: 15, cashCountTolerance: '150.5' },
      false,
    );

    expect(next).toMatchObject({
      cartIdleMinutes: 20,
      returnWindowDays: 15,
      cashCountTolerance: '150.50',
    });
  });

  it('rechaza un valor fuera de los márgenes e indica el rango', () => {
    expect(() => applyParameterChanges(DEFAULT_PARAMETERS, { cartIdleMinutes: 1 }, false)).toThrow(
      'entre 2 y 120 minutos',
    );
    expect(() =>
      applyParameterChanges(DEFAULT_PARAMETERS, { sessionIdleMinutes: 900 }, false),
    ).toThrow('entre 5 y 480 minutos');
    expect(() =>
      applyParameterChanges(DEFAULT_PARAMETERS, { cashCountTolerance: '-1' }, false),
    ).toThrow('tolerancia de arqueo');
  });

  it('la política de facturación solo cambia con el módulo de facturación activo', () => {
    expect(() =>
      applyParameterChanges(DEFAULT_PARAMETERS, { billingPolicy: 'opcional_sin_factura' }, false),
    ).toThrow('módulo de facturación activo');
    expect(
      applyParameterChanges(DEFAULT_PARAMETERS, { billingPolicy: 'opcional_sin_factura' }, true)
        .billingPolicy,
    ).toBe('opcional_sin_factura');
  });
});

describe('[RF-135] métodos de pago', () => {
  it('normaliza recargos y descuentos', () => {
    expect(normalizeSurcharge('10')).toBe('10.0000');
    expect(normalizeSurcharge('-5')).toBe('-5.0000');
    expect(normalizeSurcharge('2.75')).toBe('2.7500');
  });

  it('rechaza recargos fuera del margen o mal escritos', () => {
    expect(() => normalizeSurcharge('150')).toThrow('entre -50% y 100%');
    expect(() => normalizeSurcharge('diez')).toThrow('porcentaje');
  });
});

describe('[RF-025] bajas con dependencias', () => {
  it('rechaza la baja e indica qué la impide', () => {
    expect(() => {
      assertNoDependencies('la sucursal', {
        openShifts: 1,
        carts: 0,
        pendingTransfers: 2,
        stockedProducts: 0,
      });
    }).toThrow(
      'No se puede dar de baja la sucursal: tiene 1 turno(s) abierto(s), 2 transferencia(s) pendiente(s).',
    );
    expect(() => {
      assertNoDependencies('la caja', NO_DEPENDENCIES);
    }).not.toThrow();
  });

  it('valida el punto de venta fiscal', () => {
    expect(assertPointOfSale(3)).toBe(3);
    expect(() => assertPointOfSale(0)).toThrow('entre 1 y 99999');
  });
});
