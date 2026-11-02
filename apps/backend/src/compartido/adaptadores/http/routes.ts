// Registro de rutas de la API (T-031, AD-22). Toda ruta queda protegida por defecto: solo puede
// ser pública si declara uno de los motivos de la lista blanca de Const. 16.
import type { RequestHandler } from 'express';
import type { Action } from '../../aplicacion/permissions.js';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

// Lista blanca de endpoints públicos (Const. 16, AD-22). Agregar un motivo exige cambiar la constitución.
export const PUBLIC_ROUTE_REASONS = [
  'salud',
  'inicio_sesion',
  'validacion_correo',
  'recuperacion_contrasena',
  'webhook_integracion',
] as const;

export type PublicRouteReason = (typeof PUBLIC_ROUTE_REASONS)[number];

export interface HttpRoute {
  method: HttpMethod;
  // Sintaxis de Express: /autorizaciones/:id
  path: string;
  handler: RequestHandler;
  // Ausente: la ruta exige un token de acceso válido.
  public?: PublicRouteReason;
  // Acción de la matriz §5.18: se verifica antes de validar los datos de la solicitud, para no
  // revelar nada a quien no tiene permiso. El caso de uso la vuelve a verificar.
  action?: Action;
  // Las rutas públicas tienen límite de frecuencia (Const. 17). Ponerlo en false solo para /salud.
  rateLimited?: boolean;
  // Cuerpo binario (por ejemplo, una imagen) en lugar de JSON: tipos admitidos y tamaño máximo.
  // Se lee después de verificar el permiso.
  binaryBody?: { types: readonly string[]; maxBytes: number };
}

export function assertValidRoutes(routes: readonly HttpRoute[]): void {
  const seen = new Set<string>();
  for (const route of routes) {
    const key = `${route.method.toUpperCase()} ${route.path}`;
    if (seen.has(key)) throw new Error(`Ruta duplicada: ${key}`);
    seen.add(key);
    if (route.public !== undefined && !PUBLIC_ROUTE_REASONS.includes(route.public)) {
      throw new Error(`La ruta ${key} no puede ser pública: "${route.public}".`);
    }
  }
}
