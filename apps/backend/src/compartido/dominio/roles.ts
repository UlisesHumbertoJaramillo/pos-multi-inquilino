// Roles del sistema (spec §2). El SA administra la plataforma y nunca accede a datos comerciales.
export const ROLES = ['SA', 'AC', 'AS', 'VO'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
