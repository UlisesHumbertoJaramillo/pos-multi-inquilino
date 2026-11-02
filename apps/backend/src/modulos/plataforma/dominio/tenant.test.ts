import { describe, expect, it } from 'vitest';
import {
  applyChanges,
  close,
  NO_FISCAL_PENDING,
  normalizeCuit,
  reactivate,
  setBillingModule,
  suspend,
  type Tenant,
} from './tenant.js';

const TENANT: Tenant = {
  id: 't1',
  name: 'Kiosco',
  cuit: null,
  currency: 'ARS',
  timezone: 'America/Argentina/Buenos_Aires',
  status: 'activo',
  hasOperations: false,
  billingModule: false,
  createdAt: new Date('2026-11-02T12:00:00Z'),
};

const PENDING = { queued: 2, rejected: 1, caeaNotReported: 0 };

describe('[RF-013] [RF-134] datos del comercio', () => {
  it('sin operaciones, la moneda se puede cambiar', () => {
    expect(applyChanges(TENANT, { currency: 'USD' }).currency).toBe('USD');
  });

  it('con operaciones registradas, cambiar la moneda se rechaza', () => {
    expect(() => applyChanges({ ...TENANT, hasOperations: true }, { currency: 'USD' })).toThrow(
      'ya tiene operaciones',
    );
    // La misma moneda no es un cambio.
    expect(applyChanges({ ...TENANT, hasOperations: true }, { currency: 'ARS' }).currency).toBe(
      'ARS',
    );
  });

  it('valida la moneda, la zona horaria y el CUIT', () => {
    expect(() => applyChanges(TENANT, { currency: 'pesos' })).toThrow('ISO 4217');
    expect(() => applyChanges(TENANT, { timezone: 'Marte/Olympus' })).toThrow('zona horaria');
    expect(normalizeCuit('30712345671')).toBe('30-71234567-1');
    expect(() => normalizeCuit('30-71234567-8')).toThrow('dígito verificador');
  });
});

describe('[RF-014] [RF-147] suspensión y baja', () => {
  it('suspende un comercio activo y reactiva uno suspendido', () => {
    const suspended = suspend(TENANT);
    expect(suspended.status).toBe('suspendido');
    expect(reactivate(suspended).status).toBe('activo');
    expect(() => suspend(suspended)).toThrow('Solo se puede suspender');
    expect(() => reactivate(TENANT)).toThrow('Solo se puede reactivar');
  });

  it('la baja exige no tener comprobantes sin regularizar e indica cuáles la impiden', () => {
    expect(close(TENANT, NO_FISCAL_PENDING).status).toBe('baja');
    expect(() => close(TENANT, PENDING)).toThrow('2 en cola, 1 rechazado(s)');
  });

  it('un comercio dado de baja no se modifica', () => {
    const closed = close(TENANT, NO_FISCAL_PENDING);
    expect(() => applyChanges(closed, { name: 'Otro' })).toThrow('dado de baja');
    expect(() => setBillingModule(closed, true, NO_FISCAL_PENDING)).toThrow('dado de baja');
  });
});

describe('[RF-163] [RF-164] módulo de facturación', () => {
  it('se activa y se desactiva sin pendientes', () => {
    const active = setBillingModule(TENANT, true, NO_FISCAL_PENDING);
    expect(active.billingModule).toBe(true);
    expect(setBillingModule(active, false, NO_FISCAL_PENDING).billingModule).toBe(false);
  });

  it('desactivarlo con comprobantes pendientes se rechaza e indica cuáles lo impiden', () => {
    const active = { ...TENANT, billingModule: true };
    expect(() => setBillingModule(active, false, PENDING)).toThrow('2 en cola, 1 rechazado(s)');
  });
});
