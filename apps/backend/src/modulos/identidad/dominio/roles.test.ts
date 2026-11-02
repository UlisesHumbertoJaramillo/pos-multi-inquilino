import { describe, expect, it } from 'vitest';
import { branchesOf, initialActiveRole, type RoleAssignment } from './roles.js';

const CENTRO = 'aaaaaaaa-0000-4000-8000-000000000001';
const NORTE = 'aaaaaaaa-0000-4000-8000-000000000002';

const AS_AND_VO: RoleAssignment[] = [
  { role: 'AS', branchId: CENTRO },
  { role: 'AS', branchId: NORTE },
  { role: 'VO', branchId: CENTRO },
];

describe('[RF-005] rol activo al ingresar', () => {
  it('activa el último rol usado si sigue asignado', () => {
    expect(initialActiveRole(AS_AND_VO, 'VO')).toBe('VO');
  });

  it('con un solo rol, lo activa aunque sea el primer ingreso', () => {
    expect(initialActiveRole([{ role: 'AC', branchId: null }], null)).toBe('AC');
  });

  it('con varios roles y sin último rol, pide elegir', () => {
    expect(initialActiveRole(AS_AND_VO, null)).toBeNull();
  });

  it('si el último rol ya no está asignado, pide elegir', () => {
    expect(initialActiveRole(AS_AND_VO, 'AC')).toBeNull();
  });
});

describe('[RF-011] ámbito del rol activo', () => {
  it('el AS actúa sobre todas sus sucursales y el VO sobre la suya', () => {
    expect(branchesOf(AS_AND_VO, 'AS')).toStrictEqual([CENTRO, NORTE]);
    expect(branchesOf(AS_AND_VO, 'VO')).toStrictEqual([CENTRO]);
    expect(branchesOf(AS_AND_VO, null)).toStrictEqual([]);
  });
});
