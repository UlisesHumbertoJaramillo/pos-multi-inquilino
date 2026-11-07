import { describe, expect, it } from 'vitest';
import {
  assertWithinLaterInvoicing,
  caeaPeriodOf,
  certificateExpiresSoon,
  nextAttempt,
  nextCaeaPeriod,
  normalizeCuit,
  requiresInvoiceA,
  voucherClass,
} from './vouchers.js';

describe('[RF-155] tipo de comprobante', () => {
  it.each([
    ['responsable_inscripto', 'responsable_inscripto', 'A'],
    ['responsable_inscripto', 'monotributista', 'B'],
    ['responsable_inscripto', 'exento', 'B'],
    ['responsable_inscripto', 'consumidor_final', 'B'],
    ['responsable_inscripto', null, 'B'],
    ['monotributista', 'responsable_inscripto', 'C'],
    ['monotributista', null, 'C'],
    ['exento', 'responsable_inscripto', 'C'],
  ] as const)('emisor %s y comprador %s: %s', (issuer, buyer, expected) => {
    expect(voucherClass(issuer, buyer)).toBe(expected);
  });

  it('[RF-167] solo el comprador que recibe A obliga a facturar', () => {
    expect(requiresInvoiceA('responsable_inscripto', 'responsable_inscripto')).toBe(true);
    expect(requiresInvoiceA('responsable_inscripto', 'monotributista')).toBe(false);
    expect(requiresInvoiceA('monotributista', 'responsable_inscripto')).toBe(false);
    expect(requiresInvoiceA(null, 'responsable_inscripto')).toBe(false);
  });
});

describe('[RF-160] períodos del CAEA', () => {
  it('divide el mes en dos quincenas', () => {
    expect(caeaPeriodOf('2026-11-15')).toEqual({
      code: '2026111',
      from: '2026-11-01',
      to: '2026-11-15',
    });
    expect(caeaPeriodOf('2026-02-16')).toEqual({
      code: '2026022',
      from: '2026-02-16',
      to: '2026-02-28',
    });
  });

  it('el período siguiente cruza el año', () => {
    expect(nextCaeaPeriod(caeaPeriodOf('2026-12-20')).code).toBe('2027011');
  });
});

describe('[RF-162] datos fiscales', () => {
  it('normaliza el CUIT y rechaza uno mal formado', () => {
    expect(normalizeCuit('20-12345678-9')).toBe('20123456789');
    expect(() => normalizeCuit('123')).toThrow('11 dígitos');
  });

  it('avisa a 30 días del vencimiento del certificado', () => {
    const now = new Date('2026-11-02T00:00:00Z');
    expect(certificateExpiresSoon(new Date('2026-11-17T00:00:00Z'), now)).toBe(true);
    expect(certificateExpiresSoon(new Date('2027-11-17T00:00:00Z'), now)).toBe(false);
  });
});

describe('[RF-100] reintentos', () => {
  it('la espera crece hasta una hora', () => {
    const now = new Date('2026-11-02T00:00:00Z');
    expect(nextAttempt(1, now).toISOString()).toBe('2026-11-02T00:02:00.000Z');
    expect(nextAttempt(20, now).toISOString()).toBe('2026-11-02T01:00:00.000Z');
  });
});

describe('[RF-168] plazo de facturación posterior', () => {
  it('cero días es la misma jornada', () => {
    expect(() => {
      assertWithinLaterInvoicing('2026-11-02', 0, '2026-11-02');
    }).not.toThrow();
    expect(() => {
      assertWithinLaterInvoicing('2026-11-02', 0, '2026-11-03');
    }).toThrow('Venció');
  });
});
