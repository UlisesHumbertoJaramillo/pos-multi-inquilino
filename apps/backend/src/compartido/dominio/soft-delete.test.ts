import { describe, expect, it } from 'vitest';
import { DomainError } from './errors.js';
import { ACTIVE, deactivate } from './soft-delete.js';

const USER = '33333333-3333-4333-8333-333333333333';
const AT = new Date('2026-11-02T12:00:00.000Z');

describe('[RF-020] baja lógica', () => {
  it('desactiva y conserva quién y cuándo dio de baja', () => {
    expect(deactivate(ACTIVE, USER, AT)).toStrictEqual({
      isActive: false,
      deactivatedAt: AT,
      deactivatedBy: USER,
    });
  });

  it('no permite dar de baja dos veces el mismo registro', () => {
    const inactive = deactivate(ACTIVE, USER, AT);

    expect(() => deactivate(inactive, USER, AT)).toThrow(DomainError);
    expect(() => deactivate(inactive, USER, AT)).toThrow('ya está dado de baja');
  });
});
