// Matriz de permisos del spec §5.18 hecha código (T-037, AD-12, RF-004).
// Cada acción declara qué roles la permiten y con qué ámbito. Lo que no está aquí queda denegado.
// Las pruebas de permisos se generan desde esta misma tabla (T-038).
import type { Role } from '../dominio/roles.js';
import type { SecurityContext } from './security-context.js';

// Ámbito sobre el que actúa un rol en una acción:
// - platform: solo el SA, sin datos comerciales.
// - tenant: todo el comercio (AC).
// - branch: las sucursales asignadas al rol activo (AS, VO).
export type Scope = 'platform' | 'tenant' | 'branch';

export interface ActionRule {
  description: string;
  rf: readonly string[];
  roles: Partial<Record<Role, Scope>>;
}

export const PERMISSIONS = {
  'plataforma.comercios.gestionar': {
    description: 'Alta, modificación, suspensión y baja de comercios, con moneda y zona horaria',
    rf: ['RF-013', 'RF-014', 'RF-146', 'RF-147'],
    roles: { SA: 'platform' },
  },
  'plataforma.usuarios.crear': {
    description: 'Crear usuarios SA y el primer AC de un comercio',
    rf: ['RF-015'],
    roles: { SA: 'platform' },
  },
  'plataforma.facturacion.modulo': {
    description: 'Activar o desactivar el módulo de facturación de un comercio',
    rf: ['RF-163', 'RF-164'],
    roles: { SA: 'platform' },
  },
  'plataforma.auditoria_tecnica.consultar': {
    description: 'Consultar la auditoría técnica, el panel técnico y responder tickets de soporte',
    rf: ['RF-016', 'RF-017', 'RF-022'],
    roles: { SA: 'platform' },
  },
  'soporte.tickets.enviar': {
    description: 'Enviar tickets de soporte',
    rf: ['RF-017'],
    roles: { AC: 'tenant', AS: 'branch' },
  },
  'auditoria_comercial.consultar': {
    description: 'Consultar la auditoría comercial',
    rf: ['RF-114'],
    roles: { AC: 'tenant', AS: 'branch' },
  },
  'organizacion.gestionar': {
    description: 'Sucursales, cajas, usuarios del comercio y sus roles',
    rf: ['RF-023', 'RF-024', 'RF-025', 'RF-026'],
    roles: { AC: 'tenant' },
  },
  'parametros.gestionar': {
    description: 'Parámetros del comercio, métodos de pago y plazos',
    rf: ['RF-135'],
    roles: { AC: 'tenant' },
  },
  'facturacion.configurar': {
    description: 'Certificado fiscal, puntos de venta y política de facturación',
    rf: ['RF-162', 'RF-166'],
    roles: { AC: 'tenant' },
  },
  'facturacion.facturar_posterior': {
    description: 'Facturar una venta posterior, dentro del plazo',
    rf: ['RF-168'],
    roles: { AC: 'tenant', AS: 'branch' },
  },
  'catalogo.gestionar': {
    description:
      'Catálogo, categorías e IVA, combos, listas de precios y su asignación, promociones',
    rf: ['RF-028', 'RF-029', 'RF-048', 'RF-049', 'RF-119', 'RF-130'],
    roles: { AC: 'tenant' },
  },
  'cuota.tope.gestionar': {
    description: 'Tope de cuota de descuento del comercio',
    rf: ['RF-063'],
    roles: { AC: 'tenant' },
  },
  'proveedores.gestionar': {
    description: 'Proveedores, importación de catálogo, compras y pagos',
    rf: ['RF-034', 'RF-035', 'RF-036', 'RF-037', 'RF-038'],
    roles: { AC: 'tenant' },
  },
  'compras.recibir': {
    description: 'Recibir compras en la sucursal de destino',
    rf: ['RF-133'],
    roles: { AS: 'branch' },
  },
  'inventario.ajustar': {
    description: 'Ajustes de stock, umbrales, mermas y revisión de ítems "En Revisión"',
    rf: ['RF-040', 'RF-042', 'RF-088'],
    roles: { AS: 'branch' },
  },
  'transferencias.gestionar': {
    description: 'Emitir, recibir, rechazar y cancelar transferencias',
    rf: ['RF-044', 'RF-045', 'RF-046', 'RF-151'],
    roles: { AS: 'branch' },
  },
  'clientes.gestionar': {
    description: 'Clientes, límites de crédito y cuotas de los VO',
    rf: ['RF-064', 'RF-072', 'RF-132'],
    roles: { AS: 'branch' },
  },
  'autorizaciones.autorizar': {
    description: 'Autorizar con PIN, nunca la propia operación (y fijar el propio PIN)',
    rf: ['RF-066', 'RF-074', 'RF-081', 'RF-092', 'RF-126', 'RF-141', 'RF-113'],
    roles: { AC: 'tenant', AS: 'branch' },
  },
  'caja.cierre_forzado': {
    description: 'Forzar el cierre de un turno ajeno',
    rf: ['RF-115'],
    roles: { AS: 'branch' },
  },
  'facturacion.corregir_rechazos': {
    description: 'Corregir y reenviar comprobantes rechazados',
    rf: ['RF-104'],
    roles: { AC: 'tenant', AS: 'branch' },
  },
  'simulador.operar': {
    description: 'Controlar el simulador de la pasarela de pagos (solo fuera de producción)',
    rf: ['RF-075'],
    roles: { AC: 'tenant', AS: 'branch', VO: 'branch' },
  },
  'ventas.operar': {
    description: 'Abrir turno, vender, cobrar, aplicar descuentos de su cuota, traspasar ventas',
    rf: ['RF-053', 'RF-080'],
    roles: { VO: 'branch' },
  },
  'devoluciones.iniciar': {
    description:
      'Iniciar devoluciones y anulaciones, movimientos de caja, cobros de cuenta corriente',
    rf: ['RF-081', 'RF-091', 'RF-128'],
    roles: { VO: 'branch' },
  },
  'caja.corte_x': {
    description: 'Corte X de su turno',
    rf: ['RF-094'],
    roles: { VO: 'branch' },
  },
  'caja.corte_z': {
    description: 'Corte Z (sin turno abierto en esa caja)',
    rf: ['RF-095'],
    roles: { AS: 'branch', VO: 'branch' },
  },
  'dashboard.estrategico': {
    description: 'Dashboard estratégico',
    rf: ['RF-110'],
    roles: { AC: 'tenant' },
  },
  'dashboard.operativo': {
    description: 'Dashboard operativo e informe diario',
    rf: ['RF-109', 'RF-111'],
    roles: { AC: 'tenant', AS: 'branch' },
  },
} as const satisfies Record<string, ActionRule>;

export type Action = keyof typeof PERMISSIONS;

// Recurso sobre el que se actúa. Sin recurso, solo se verifica el rol y el comercio de la sesión.
export interface ResourceScope {
  tenantId?: string | null;
  branchId?: string | null;
}

export type PermissionDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | 'not_in_matrix'
        | 'no_active_role'
        | 'role_not_allowed'
        | 'sa_commercial_data'
        | 'other_tenant'
        | 'out_of_branch';
    };

export function isAction(value: string): value is Action {
  return Object.hasOwn(PERMISSIONS, value);
}

export function decide(
  context: SecurityContext,
  action: string,
  resource: ResourceScope = {},
): PermissionDecision {
  if (!isAction(action)) return { allowed: false, reason: 'not_in_matrix' };
  const role = context.activeRole;
  if (role === null) return { allowed: false, reason: 'no_active_role' };

  const rules: Partial<Record<Role, Scope>> = PERMISSIONS[action].roles;
  const scope = rules[role];

  // El SA nunca accede a datos comerciales (RF-003), aunque la tabla tuviera un error.
  if (role === 'SA' && scope !== 'platform')
    return { allowed: false, reason: 'sa_commercial_data' };
  if (scope === undefined) return { allowed: false, reason: 'role_not_allowed' };
  if (scope === 'platform') return { allowed: true };

  // Acciones comerciales: el recurso tiene que ser del comercio de la sesión.
  if (context.tenantId === null) return { allowed: false, reason: 'role_not_allowed' };
  if (resource.tenantId != null && resource.tenantId !== context.tenantId) {
    return { allowed: false, reason: 'other_tenant' };
  }
  if (
    scope === 'branch' &&
    resource.branchId != null &&
    !context.branchIds.includes(resource.branchId)
  ) {
    return { allowed: false, reason: 'out_of_branch' };
  }
  return { allowed: true };
}
