// Rol activo (RF-005, RF-010, D-45).
import type { Role } from '../../../compartido/dominio/roles.js';

export interface RoleAssignment {
  role: Role;
  // Sucursal del AS o del VO. Nula para AC y SA.
  branchId: string | null;
}

export function assignedRoles(assignments: readonly RoleAssignment[]): Role[] {
  return [...new Set(assignments.map((assignment) => assignment.role))];
}

// Al ingresar: el último rol usado si sigue asignado; si tiene un solo rol, ese; si no, debe elegir.
export function initialActiveRole(
  assignments: readonly RoleAssignment[],
  lastActiveRole: Role | null,
): Role | null {
  const roles = assignedRoles(assignments);
  if (lastActiveRole !== null && roles.includes(lastActiveRole)) return lastActiveRole;
  return roles.length === 1 ? (roles[0] ?? null) : null;
}

// Sucursales sobre las que actúa un rol: las de sus asignaciones (AS puede tener varias).
export function branchesOf(assignments: readonly RoleAssignment[], role: Role | null): string[] {
  if (role === null) return [];
  return [
    ...new Set(
      assignments
        .filter((assignment) => assignment.role === role && assignment.branchId !== null)
        .map((assignment) => assignment.branchId ?? ''),
    ),
  ];
}
