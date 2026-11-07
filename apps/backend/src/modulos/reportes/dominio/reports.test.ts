import { describe, expect, it } from 'vitest';
import {
  assertDay,
  assertPeriod,
  averageTicket,
  dateIn,
  defaultPeriod,
  ticketIdentification,
} from './reports.js';

describe('[RF-109] fechas y períodos de los reportes', () => {
  it('la fecha de hoy es la de la zona del comercio', () => {
    expect(dateIn(new Date('2026-11-03T02:00:00Z'), 'America/Argentina/Buenos_Aires')).toBe(
      '2026-11-02',
    );
  });

  it('rechaza fechas inexistentes o mal escritas', () => {
    expect(assertDay('2028-02-29')).toBe('2028-02-29');
    expect(() => assertDay('2026-02-30')).toThrow(/no es una fecha válida/);
    expect(() => assertDay('2-11-2026')).toThrow(/no es una fecha válida/);
  });

  it('el período es inclusivo, ordenado y de hasta un año', () => {
    expect(assertPeriod({ from: '2026-01-01', to: '2026-12-31' })).toBeTruthy();
    expect(() => assertPeriod({ from: '2026-11-02', to: '2026-11-01' })).toThrow(/posterior/);
    expect(() => assertPeriod({ from: '2025-01-01', to: '2026-01-02' })).toThrow(/366 días/);
  });

  it('por defecto, los últimos 30 días hasta hoy', () => {
    expect(defaultPeriod('2026-11-02')).toEqual({ from: '2026-10-04', to: '2026-11-02' });
  });
});

describe('[RF-110] ticket promedio (D-50)', () => {
  it('redondea al centavo y es cero sin tickets', () => {
    expect(averageTicket('7000.00', 4)).toBe('1750.00');
    expect(averageTicket('100.00', 3)).toBe('33.33');
    expect(averageTicket('200.00', 3)).toBe('66.67');
    expect(averageTicket('0.00', 0)).toBe('0.00');
  });
});

describe('[RF-107] identificación del ticket', () => {
  const voucher = { state: 'aceptado', nonFiscal: false, authorized: true };

  it('una venta sin factura es un ticket no válido como factura', () => {
    expect(ticketIdentification({ billed: false, voucher: null })).toBe('no_valido_como_factura');
  });

  it('con el comprobante autorizado es un comprobante fiscal', () => {
    expect(ticketIdentification({ billed: true, voucher })).toBe('comprobante_fiscal');
  });

  it('mientras el comprobante no se autoriza, la factura está en trámite', () => {
    expect(ticketIdentification({ billed: true, voucher: null })).toBe('factura_en_tramite');
    expect(
      ticketIdentification({ billed: true, voucher: { ...voucher, state: 'pendiente' } }),
    ).toBe('factura_en_tramite');
  });

  it('el ticket emitido como no fiscal por la contingencia no vale como factura', () => {
    expect(ticketIdentification({ billed: true, voucher: { ...voucher, nonFiscal: true } })).toBe(
      'no_valido_como_factura',
    );
  });
});
