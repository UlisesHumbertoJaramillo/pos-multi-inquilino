import { describe, expect, it } from 'vitest';
import { assertResolvable, isVisibleTo, nextReminder, REMINDER_INTERVAL_MS } from './alerts.js';

const branchAlert = { recipientRole: 'AS' as const, recipientId: null, branchId: 'centro' };

describe('[RF-041] [RF-098] quién ve una alerta (D-91)', () => {
  it('todos los AS de la sucursal ven la alerta dirigida al rol', () => {
    expect(isVisibleTo(branchAlert, { role: 'AS', userId: 'a', branchIds: ['centro'] })).toBe(true);
    expect(isVisibleTo(branchAlert, { role: 'AS', userId: 'b', branchIds: ['centro'] })).toBe(true);
  });

  it('el AS de otra sucursal no la ve', () => {
    expect(isVisibleTo(branchAlert, { role: 'AS', userId: 'a', branchIds: ['norte'] })).toBe(false);
  });

  it('otro rol no la ve, aunque sea de la sucursal', () => {
    expect(isVisibleTo(branchAlert, { role: 'VO', userId: 'a', branchIds: ['centro'] })).toBe(
      false,
    );
    expect(isVisibleTo(branchAlert, { role: 'AC', userId: 'a', branchIds: null })).toBe(false);
  });

  it('el AC ve las del AC de todo el comercio, con o sin sucursal', () => {
    const audience = { role: 'AC' as const, userId: 'a', branchIds: null };
    expect(isVisibleTo({ ...branchAlert, recipientRole: 'AC' }, audience)).toBe(true);
    expect(isVisibleTo({ ...branchAlert, recipientRole: 'AC', branchId: null }, audience)).toBe(
      true,
    );
  });

  it('una alerta dirigida a una persona solo la ve esa persona', () => {
    const personal = { ...branchAlert, recipientId: 'a' };
    expect(isVisibleTo(personal, { role: 'AS', userId: 'a', branchIds: ['centro'] })).toBe(true);
    expect(isVisibleTo(personal, { role: 'AS', userId: 'b', branchIds: ['centro'] })).toBe(false);
  });
});

describe('[RF-127] resolver una alerta a mano', () => {
  const open = {
    type: 'transferencia_faltante',
    severity: 'advertencia' as const,
    resolvedAt: null,
  };

  it('una advertencia se resuelve sin nota', () => {
    expect(assertResolvable(open, null)).toBeNull();
    expect(assertResolvable(open, '  revisado  ')).toBe('revisado');
  });

  it('una crítica exige una nota', () => {
    const critical = { ...open, type: 'reintegro_pendiente', severity: 'critica' as const };
    expect(() => assertResolvable(critical, ' ')).toThrow(/qué se hizo/);
    expect(assertResolvable(critical, 'Reintegrado por transferencia')).toBe(
      'Reintegrado por transferencia',
    );
  });

  it.each(['stock_minimo', 'fiscal_plazo_vencido', 'jornada_sin_z'])(
    '%s se resuelve sola y no se descarta',
    (type) => {
      expect(() => assertResolvable({ ...open, type }, 'x')).toThrow(/se resuelve sola/);
    },
  );

  it('una resuelta no se vuelve a resolver', () => {
    expect(() => assertResolvable({ ...open, resolvedAt: new Date() }, null)).toThrow(
      /ya está resuelta/,
    );
  });

  it('la nota tiene un largo máximo', () => {
    expect(() => assertResolvable(open, 'x'.repeat(201))).toThrow(/200 caracteres/);
  });
});

describe('recordatorio de las persistentes (D-91)', () => {
  it('se repite cada 24 horas', () => {
    const now = new Date('2026-11-07T12:00:00Z');
    expect(nextReminder(now).getTime() - now.getTime()).toBe(REMINDER_INTERVAL_MS);
    expect(REMINDER_INTERVAL_MS).toBe(86_400_000);
  });
});
