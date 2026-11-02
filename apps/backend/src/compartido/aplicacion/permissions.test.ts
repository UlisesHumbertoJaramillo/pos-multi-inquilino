// Pruebas generadas desde la matriz de permisos (T-038, AD-12): cada acción × cada rol × ámbito.
// Al agregar una acción a PERMISSIONS, sus casos se agregan solos.
import { describe, expect, it } from 'vitest';
import { ROLES, type Role } from '../dominio/roles.js';
import { decide, PERMISSIONS, type Action, type Scope } from './permissions.js';
import type { SecurityContext } from './security-context.js';

const TENANT = 'a0000000-0000-4000-8000-00000000000a';
const OTHER_TENANT = 'b0000000-0000-4000-8000-00000000000b';
const BRANCH = 'a1000000-0000-4000-8000-000000000001';
const OTHER_BRANCH = 'a1000000-0000-4000-8000-000000000002';

function contextFor(role: Role | null): SecurityContext {
  return {
    userId: 'u',
    tenantId: role === 'SA' ? null : TENANT,
    activeRole: role,
    branchIds: role === 'AS' || role === 'VO' ? [BRANCH] : [],
    sessionId: 's',
  };
}

const actions = Object.keys(PERMISSIONS) as Action[];
const cases = actions.flatMap((action) =>
  ROLES.map((role) => {
    const rules: Partial<Record<Role, Scope>> = PERMISSIONS[action].roles;
    return { action, role, scope: rules[role] };
  }),
);

describe('[RF-004] matriz de permisos §5.18', () => {
  describe.each(cases)('$action con rol $role', ({ action, role, scope }) => {
    if (scope === undefined) {
      it('se deniega', () => {
        expect(decide(contextFor(role), action).allowed).toBe(false);
        expect(
          decide(contextFor(role), action, { tenantId: TENANT, branchId: BRANCH }).allowed,
        ).toBe(false);
      });
      return;
    }

    if (scope === 'platform') {
      it('se permite, sin recursos comerciales', () => {
        expect(decide(contextFor(role), action)).toStrictEqual({ allowed: true });
      });
      return;
    }

    it('se permite dentro de su ámbito', () => {
      expect(
        decide(contextFor(role), action, { tenantId: TENANT, branchId: BRANCH }),
      ).toStrictEqual({
        allowed: true,
      });
    });

    it('se deniega sobre un recurso de otro comercio', () => {
      expect(decide(contextFor(role), action, { tenantId: OTHER_TENANT })).toStrictEqual({
        allowed: false,
        reason: 'other_tenant',
      });
    });

    if (scope === 'branch') {
      it('se deniega fuera de sus sucursales', () => {
        expect(
          decide(contextFor(role), action, { tenantId: TENANT, branchId: OTHER_BRANCH }),
        ).toStrictEqual({ allowed: false, reason: 'out_of_branch' });
      });
    } else {
      it('vale para cualquier sucursal del comercio', () => {
        expect(
          decide(contextFor(role), action, { tenantId: TENANT, branchId: OTHER_BRANCH }).allowed,
        ).toBe(true);
      });
    }
  });

  it('una acción que no está en la tabla queda denegada para todos los roles', () => {
    for (const role of ROLES) {
      expect(decide(contextFor(role), 'acciones.inventadas')).toStrictEqual({
        allowed: false,
        reason: 'not_in_matrix',
      });
    }
  });

  it('sin rol activo (primer ingreso sin elegir) se deniega toda acción', () => {
    for (const action of actions) {
      expect(decide(contextFor(null), action)).toStrictEqual({
        allowed: false,
        reason: 'no_active_role',
      });
    }
  });
});

describe('[RF-003] el SA no accede a datos comerciales', () => {
  const commercial = actions.filter((action) => {
    const rules: Partial<Record<Role, Scope>> = PERMISSIONS[action].roles;
    return rules.SA !== 'platform';
  });

  it('la matriz tiene acciones comerciales que probar', () => {
    expect(commercial.length).toBeGreaterThan(15);
  });

  it.each(commercial)('se rechaza %s', (action) => {
    expect(decide(contextFor('SA'), action, { tenantId: TENANT }).allowed).toBe(false);
  });

  it('se rechaza aunque la tabla tuviera un error que le diera una acción comercial', () => {
    const mistaken = PERMISSIONS['catalogo.gestionar'].roles as Partial<Record<Role, Scope>>;
    mistaken.SA = 'tenant';
    try {
      expect(decide(contextFor('SA'), 'catalogo.gestionar')).toStrictEqual({
        allowed: false,
        reason: 'sa_commercial_data',
      });
    } finally {
      delete mistaken.SA;
    }
  });
});
