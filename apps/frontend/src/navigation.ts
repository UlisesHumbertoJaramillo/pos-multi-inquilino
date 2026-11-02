// Menú de cada rol. Solo decide qué se muestra: los permisos los verifica el backend (Const. 15).
import type { Role } from '@pos/contracts';

export interface NavItem {
  label: string;
  path: string;
  // Las secciones de entregas futuras se muestran deshabilitadas.
  available: boolean;
}

export const ROLE_NAMES: Record<Role, string> = {
  SA: 'Super Administrador',
  AC: 'Administrador de Comercio',
  AS: 'Administrador de Sucursal',
  VO: 'Vendedor',
};

export const NAVIGATION: Record<Role, NavItem[]> = {
  SA: [
    { label: 'Inicio', path: '/admin', available: true },
    { label: 'Comercios', path: '/admin/comercios', available: true },
    { label: 'Cuentas SA', path: '/admin/cuentas', available: true },
    { label: 'Soporte', path: '/admin/soporte', available: true },
    { label: 'Auditoría técnica', path: '/admin/auditoria-tecnica', available: true },
    { label: 'Panel técnico', path: '/admin/panel', available: true },
  ],
  AC: [
    { label: 'Inicio', path: '/admin', available: true },
    { label: 'Sucursales y usuarios', path: '/admin/organizacion', available: false },
    { label: 'Catálogo y precios', path: '/admin/catalogo', available: false },
    { label: 'Proveedores', path: '/admin/proveedores', available: false },
    { label: 'Dashboard', path: '/admin/dashboard', available: false },
  ],
  AS: [
    { label: 'Inicio', path: '/admin', available: true },
    { label: 'Inventario', path: '/admin/inventario', available: false },
    { label: 'Transferencias', path: '/admin/transferencias', available: false },
    { label: 'Clientes', path: '/admin/clientes', available: false },
    { label: 'Informe diario', path: '/admin/informe', available: false },
  ],
  VO: [
    { label: 'Punto de venta', path: '/pos', available: true },
    { label: 'Caja', path: '/pos/caja', available: false },
  ],
};

// Pantalla inicial de cada rol.
export function homeFor(role: Role | null): string {
  if (role === null) return '/elegir-rol';
  return role === 'VO' ? '/pos' : '/admin';
}
