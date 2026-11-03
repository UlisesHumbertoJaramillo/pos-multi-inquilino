// Matriz de permisos sobre las rutas reales (T-038, T-059, T-071, T-087, T-102; RF-001, RF-003,
// RF-004).
// Se genera desde el registro de rutas: cada ruta con acción × cada rol. Al agregar una ruta con
// acción, sus casos se agregan solos.
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { decide, PERMISSIONS } from '../../src/compartido/aplicacion/permissions.js';
import { ROLES, type Role } from '../../src/compartido/dominio/roles.js';
import { createTestApi } from '../support/app.js';
import { ownerQuery, ownerSelect } from '../support/database.js';
import {
  BRANCH_B,
  BRANCH_CENTRO,
  BRANCH_NORTE,
  seedIdentity,
  signIn,
  TENANT_A,
  USERS,
} from '../support/identity-fixtures.js';

const api = createTestApi();
afterAll(() => api.close());

const EMAIL_BY_ROLE: Record<Role, string> = {
  SA: USERS.sa.email,
  AC: USERS.ac.email,
  AS: USERS.asVo.email,
  VO: USERS.vo.email,
};

const routesWithAction = api.routes.filter((route) => route.action !== undefined);
const cases = routesWithAction.flatMap((route) => ROLES.map((role) => ({ route, role })));
const authorization = new Map<Role, string>();

// Inicia sesión solo con el rol que usa cada caso.
async function authorize(role: Role): Promise<string> {
  let value = authorization.get(role);
  if (value === undefined) {
    value = (await signIn(api.app, EMAIL_BY_ROLE[role], role)).authorization;
    authorization.set(role, value);
  }
  return value;
}

// Un valor concreto para los parámetros de ruta.
const concretePath = (path: string) => path.replace(/:\w+/g, TENANT_A);

// El arnés vacía las tablas antes de cada prueba: las sesiones se crean de nuevo cada vez.
beforeEach(async () => {
  authorization.clear();
  await seedIdentity();
});

describe('[RF-004] matriz de permisos en las rutas', () => {
  it('hay rutas de plataforma y de comercio para probar', () => {
    expect(
      routesWithAction.filter((r) => r.path.startsWith('/plataforma/')).length,
    ).toBeGreaterThan(10);
    expect(routesWithAction.some((r) => !r.path.startsWith('/plataforma/'))).toBe(true);
  });

  it.each(cases)('$route.method $route.path con rol $role', async ({ route, role }) => {
    const allowed = decide(
      {
        userId: 'u',
        tenantId: role === 'SA' ? null : TENANT_A,
        activeRole: role,
        branchIds: [],
        sessionId: 's',
      },
      route.action ?? '',
    ).allowed;

    // Sin cuerpo: la verificación del permiso tiene que ocurrir antes que la de los datos.
    const response = await request(api.app)
      [route.method](concretePath(route.path))
      .set('Authorization', await authorize(role));

    if (allowed) {
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    } else {
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ codigo: 'SIN_PERMISO' });
    }
  });
});

describe('[RF-003] un usuario de un comercio no ejecuta acciones del SA', () => {
  const platformRoutes = routesWithAction.filter((route) => route.path.startsWith('/plataforma/'));

  it.each(platformRoutes)('el AC recibe 403 en $method $path', async (route) => {
    const response = await request(api.app)
      [route.method](concretePath(route.path))
      .set('Authorization', await authorize('AC'));

    expect(response.status).toBe(403);
  });
});

// Acceso cruzado: el AC (o el AS, en inventario) del comercio B usa ids de recursos del A en cada
// ruta comercial que recibe un id. Al agregar una ruta así, su caso se agrega solo.
describe('[RF-001] acceso cruzado entre comercios en las rutas comerciales', () => {
  const REGISTER_A = 'a2000000-0000-4000-8000-000000000001';
  const PAYMENT_METHOD_A = 'a3000000-0000-4000-8000-000000000001';
  const CATEGORY_A = 'a4000000-0000-4000-8000-000000000001';
  const PRODUCT_A = 'a5000000-0000-4000-8000-000000000001';
  const PRICE_LIST_A = 'a6000000-0000-4000-8000-000000000001';
  const SUPPLIER_A = 'a8000000-0000-4000-8000-000000000001';
  const PURCHASE_A = 'a9000000-0000-4000-8000-000000000001';
  const TRANSFER_A = 'a7000000-0000-4000-8000-000000000001';
  // Recurso del comercio A según el segmento de la ruta (/organizacion/cajas/:id → cajas).
  const FOREIGN: Record<string, { resourceType: string; id: string }> = {
    sucursales: { resourceType: 'sucursal', id: BRANCH_CENTRO },
    cajas: { resourceType: 'caja', id: REGISTER_A },
    usuarios: { resourceType: 'usuario', id: USERS.vo.id },
    'metodos-pago': { resourceType: 'metodo_pago', id: PAYMENT_METHOD_A },
    categorias: { resourceType: 'categoria', id: CATEGORY_A },
    productos: { resourceType: 'producto', id: PRODUCT_A },
    combos: { resourceType: 'producto', id: PRODUCT_A },
    listas: { resourceType: 'lista_precio', id: PRICE_LIST_A },
    transferencias: { resourceType: 'transferencia', id: TRANSFER_A },
    proveedores: { resourceType: 'proveedor', id: SUPPLIER_A },
    compras: { resourceType: 'compra', id: PURCHASE_A },
  };
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  // Un cuerpo válido: la respuesta tiene que depender del recurso, no de los datos.
  const bodyFor = (path: string): object => {
    if (path.endsWith('/cajas')) return { nombre: 'Intrusa' };
    if (path.endsWith('/roles')) return { roles: [{ rol: 'VO', sucursalId: BRANCH_B }] };
    if (path.endsWith('/precios/:productoId')) return { precio: '1' };
    if (path.endsWith('/lista')) return { listaId: PRICE_LIST_A };
    if (path.endsWith('/ajustes'))
      return { productoId: PRODUCT_A, cantidad: '1', motivo: 'Intrusión' };
    if (path.endsWith('/umbrales/:productoId')) return { umbral: '1' };
    if (path.endsWith('/mermas')) return { productoId: PRODUCT_A, cantidad: '1', motivo: 'rotura' };
    if (path.endsWith('/revision/:productoId')) return { accion: 'reingresar', cantidad: '1' };
    if (path.endsWith('/recepcion')) return { items: [] };
    if (path.endsWith('/pagos'))
      return { monto: '1', metodo: 'efectivo', comprobante: 'Intrusión' };
    return {};
  };
  const crossTenantRoutes = routesWithAction.filter(
    (route) =>
      route.path.includes(':id') &&
      ['organizacion', 'catalogo', 'inventario', 'proveedores', 'compras'].includes(
        route.path.split('/')[1] ?? '',
      ),
  );

  beforeEach(async () => {
    await ownerQuery(
      `INSERT INTO caja (id, tenant_id, sucursal_id, nombre, creado_en)
       VALUES ($1, $2, $3, 'Caja A', now())`,
      [REGISTER_A, TENANT_A, BRANCH_CENTRO],
    );
    await ownerQuery(
      `INSERT INTO metodo_pago (id, tenant_id, nombre, tipo, recargo_pct, creado_en)
       VALUES ($1, $2, 'Efectivo', 'efectivo', 0, now())`,
      [PAYMENT_METHOD_A, TENANT_A],
    );
    await ownerQuery(
      `INSERT INTO categoria (id, tenant_id, nombre, tasa_iva, creado_en)
       VALUES ($1, $2, 'Bebidas', 21, now())`,
      [CATEGORY_A, TENANT_A],
    );
    await ownerQuery(
      `INSERT INTO producto (id, tenant_id, tipo, nombre, categoria_id, costo, creado_en)
       VALUES ($1, $2, 'simple', 'Agua', $3, 100, now())`,
      [PRODUCT_A, TENANT_A, CATEGORY_A],
    );
    await ownerQuery(
      `INSERT INTO lista_precio (id, tenant_id, nombre, regla, creado_en)
       VALUES ($1, $2, 'Minorista', 'fijo', now())`,
      [PRICE_LIST_A, TENANT_A],
    );
    await ownerQuery(
      `INSERT INTO transferencia (id, tenant_id, sucursal_origen_id, sucursal_destino_id, estado,
         emitida_por, emitida_en)
       VALUES ($1, $2, $3, $4, 'enviada', $5, now())`,
      [TRANSFER_A, TENANT_A, BRANCH_CENTRO, BRANCH_NORTE, USERS.asVo.id],
    );
    await ownerQuery(
      `INSERT INTO proveedor (id, tenant_id, razon_social, creado_en) VALUES ($1, $2, 'Sur', now())`,
      [SUPPLIER_A, TENANT_A],
    );
    await ownerQuery(
      `INSERT INTO compra (id, tenant_id, proveedor_id, sucursal_destino_id, estado, total,
         registrada_por, registrada_en)
       VALUES ($1, $2, $3, $4, 'pendiente', 0, $5, now())`,
      [PURCHASE_A, TENANT_A, SUPPLIER_A, BRANCH_CENTRO, USERS.ac.id],
    );
  });

  // Recurso de la ruta: el segmento anterior a :id (/proveedores/:id/pagos → proveedores).
  const resourceSegment = (path: string) => {
    const segments = path.split('/');
    return segments[segments.indexOf(':id') - 1] ?? '';
  };

  it('cubre todas las rutas comerciales con id', () => {
    expect(crossTenantRoutes.length).toBeGreaterThanOrEqual(30);
    for (const route of crossTenantRoutes) {
      expect(FOREIGN[resourceSegment(route.path)]).toBeDefined();
    }
  });

  it.each(crossTenantRoutes)('$method $path responde 404 y queda auditado', async (route) => {
    const target = FOREIGN[resourceSegment(route.path)];
    if (!target) throw new Error(`Falta un recurso para ${route.path}`);
    // El inventario es del AS (§5.18); el resto, del AC.
    // Si la acción no es del AC (inventario, recepción de compras), intenta el AS del comercio B.
    if (route.action === undefined) throw new Error(`Falta la acción de ${route.path}`);
    const roles: Partial<Record<Role, unknown>> = PERMISSIONS[route.action].roles;
    const intruder = roles.AC === undefined ? USERS.asB : USERS.acB;
    const auth = (await signIn(api.app, intruder.email)).authorization;
    const path = route.path
      .replace(':id', target.id)
      .replace(':productoId', PRODUCT_A)
      .replace(':alertaId', TRANSFER_A);

    const pending = request(api.app)[route.method](path).set('Authorization', auth);
    const response = route.binaryBody
      ? await pending.set('Content-Type', route.binaryBody.types[0] ?? '').send(PNG)
      : await pending.send(bodyFor(route.path));

    expect(response.status).toBe(404);
    const audit = await ownerSelect<{ actor_id: string; detalle: unknown }>(
      "SELECT actor_id, detalle FROM auditoria_tecnica WHERE tipo_evento = 'acceso_otro_comercio'",
    );
    expect(audit).toStrictEqual([
      {
        actor_id: intruder.id,
        detalle: { resourceType: target.resourceType, resourceId: target.id },
      },
    ]);
  });
});

describe('[RF-004] un AS no modifica precios ni el catálogo', () => {
  const catalogWrites = routesWithAction.filter(
    (route) => route.path.startsWith('/catalogo/') && route.method !== 'get',
  );

  it.each(catalogWrites)('el AS recibe 403 en $method $path', async (route) => {
    const response = await request(api.app)
      [route.method](concretePath(route.path))
      .set('Authorization', await authorize('AS'));

    expect(response.status).toBe(403);
  });
});

describe('[RF-004] el AS de una sucursal no opera el stock de otra', () => {
  const branchRoutes = routesWithAction.filter((route) =>
    route.path.startsWith('/inventario/sucursales/:id/'),
  );
  // Cuerpos válidos: el rechazo tiene que venir de la sucursal, no de los datos.
  const BODIES: Record<string, object> = {
    ajustes: { productoId: BRANCH_CENTRO, cantidad: '1', motivo: 'Intento ajeno' },
    umbrales: { umbral: '1' },
    mermas: { productoId: BRANCH_CENTRO, cantidad: '1', motivo: 'rotura' },
    revision: { accion: 'reingresar', cantidad: '1' },
  };

  it.each(branchRoutes)('el AS de Norte recibe 403 en $method $path de Centro', async (route) => {
    const asNorte = (await signIn(api.app, USERS.asNorte.email, 'AS')).authorization;
    const path = route.path
      .replace(':id', BRANCH_CENTRO)
      .replace(':productoId', BRANCH_CENTRO)
      .replace(':alertaId', BRANCH_CENTRO);

    const response = await request(api.app)
      [route.method](path)
      .set('Authorization', asNorte)
      .send(BODIES[route.path.split('/')[4] ?? ''] ?? {});

    expect(response.status).toBe(403);
  });
});
