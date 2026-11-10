// Matriz de seguridad completa (T-243, criterio 2 del spec): cada fila de §5.18 y cada tipo de
// recurso, en lectura y en escritura, desde otro comercio y con los roles sin permiso.
// La lista de tipos y las filas se leen del spec: si cambian ahí, estas pruebas fallan hasta cubrirlas.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  type Action,
  type Scope,
} from '../../src/compartido/aplicacion/permissions.js';
import { ROLES, type Role } from '../../src/compartido/dominio/roles.js';
import { createTestApi } from '../support/app.js';
import { ownerQuery, ownerSelect } from '../support/database.js';
import {
  bodyFor,
  CATEGORY_A,
  COLLECTION_A,
  CONFIRMED_TICKET_NUMBER_A,
  CREDIT_NOTE_A,
  CUSTOMER_A,
  PRICE_LIST_A,
  PRODUCT_A,
  PROMOTION_A,
  PURCHASE_A,
  REGISTER_A,
  SALE_A,
  seedForeignResources,
  SHIFT_A,
  SUPPLIER_A,
  SUPPORT_TICKET_A,
  TRANSFER_A,
  VOUCHER_A,
} from '../support/foreign-resources.js';
import {
  BRANCH_B,
  BRANCH_CENTRO,
  seedIdentity,
  signIn,
  TENANT_A,
  USERS,
} from '../support/identity-fixtures.js';

const api = createTestApi();
afterAll(() => api.close());

const SPEC = readFileSync(resolve(import.meta.dirname, '../../../../sdd/spec.md'), 'utf8');

const routeFor = (path: string, read: boolean) => {
  const route = api.routes.find(
    (r) => r.path === path && r.action !== undefined && (r.method === 'get') === read,
  );
  if (!route?.action)
    throw new Error(`No existe la ruta ${read ? 'de lectura' : 'de escritura'} ${path}`);
  return { ...route, action: route.action };
};

const rolesOf = (action: string): Partial<Record<Role, Scope>> =>
  PERMISSIONS[action as Action].roles;

// El usuario del comercio B que más permisos tiene sobre la acción.
function intruderFor(action: string) {
  const roles = rolesOf(action);
  if (roles.AC !== undefined) return USERS.acB;
  if (roles.AS !== undefined) return USERS.asB;
  return roles.VO !== undefined ? USERS.voB : USERS.acB;
}

const EMAIL_BY_ROLE: Record<Role, string> = {
  SA: USERS.sa.email,
  AC: USERS.ac.email,
  AS: USERS.asVo.email,
  VO: USERS.vo.email,
};

beforeEach(async () => {
  await seedIdentity();
  await seedForeignResources();
});

describe('[RF-004] cada fila de §5.18 coincide con la tabla de permisos', () => {
  // Fila del spec (por su comienzo) → acción del código.
  const ROW_ACTIONS: readonly (readonly [string, Action])[] = [
    ['Alta, modificación, suspensión y baja', 'plataforma.comercios.gestionar'],
    ['Crear usuarios SA', 'plataforma.usuarios.crear'],
    ['Activar o desactivar el módulo', 'plataforma.facturacion.modulo'],
    ['Consultar la auditoría técnica', 'plataforma.auditoria_tecnica.consultar'],
    ['Enviar tickets de soporte', 'soporte.tickets.enviar'],
    ['Consultar la auditoría comercial', 'auditoria_comercial.consultar'],
    ['Sucursales, cajas, usuarios', 'organizacion.gestionar'],
    ['Parámetros del comercio', 'parametros.gestionar'],
    ['Certificado fiscal', 'facturacion.configurar'],
    ['Facturar una venta posterior', 'facturacion.facturar_posterior'],
    ['Catálogo, categorías', 'catalogo.gestionar'],
    ['Tope de cuota', 'cuota.tope.gestionar'],
    ['Proveedores, importación', 'proveedores.gestionar'],
    ['Recibir compras', 'compras.recibir'],
    ['Ajustes de stock', 'inventario.ajustar'],
    ['Emitir, recibir, rechazar', 'transferencias.gestionar'],
    ['Clientes, límites de crédito', 'clientes.gestionar'],
    ['Autorizar con PIN', 'autorizaciones.autorizar'],
    ['Forzar el cierre', 'caja.cierre_forzado'],
    ['Corregir y reenviar', 'facturacion.corregir_rechazos'],
    ['Abrir turno, vender', 'ventas.operar'],
    ['Iniciar devoluciones', 'devoluciones.iniciar'],
    ['Corte X', 'caja.corte_x'],
    ['Corte Z', 'caja.corte_z'],
    ['Dashboard estratégico', 'dashboard.estrategico'],
    ['Dashboard operativo', 'dashboard.operativo'],
    ['Ver y resolver las alertas', 'alertas.consultar'],
  ];
  const section = SPEC.slice(SPEC.indexOf('### 5.18'), SPEC.indexOf('## 6. Fuera de alcance'));
  const rows = section
    .split(/\r?\n/)
    .filter((line) => line.startsWith('| ') && line.includes('RF-'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .map((cells) => ({
      text: cells[1] ?? '',
      allowed: { SA: cells[2] ?? '', AC: cells[3] ?? '', AS: cells[4] ?? '', VO: cells[5] ?? '' },
    }));

  const actionOf = (text: string) => ROW_ACTIONS.find(([start]) => text.startsWith(start))?.[1];

  it('toda fila del spec tiene su acción y toda acción, su fila', () => {
    expect(rows.length).toBe(ROW_ACTIONS.length);
    expect(rows.map((row) => row.text).filter((text) => actionOf(text) === undefined)).toEqual([]);
    // El simulador no es una función del producto: solo existe fuera de producción.
    const mapped = new Set<string>([
      ...ROW_ACTIONS.map(([, action]) => action),
      'simulador.operar',
    ]);
    expect(Object.keys(PERMISSIONS).filter((action) => !mapped.has(action))).toEqual([]);
  });

  it.each(rows)('«$text» da permiso a los mismos roles que el spec', ({ text, allowed }) => {
    const action = actionOf(text);
    if (!action) throw new Error(`Fila sin acción: ${text}`);
    const rules = rolesOf(action);
    for (const role of ROLES) {
      expect(allowed[role].startsWith('✔'), `${action} con ${role}`).toBe(
        rules[role] !== undefined,
      );
    }
    if (allowed.SA) expect(rules.SA).toBe('platform');
    if (allowed.AC) expect(rules.AC).toBe('tenant');
    if (allowed.AS) expect(rules.AS).toBe('branch');
    if (allowed.VO) expect(rules.VO).toBe('branch');
  });

  it.each(ROW_ACTIONS)('«%s» tiene al menos una ruta real', (_row, action) => {
    expect(api.routes.some((route) => route.action === action)).toBe(true);
  });
});

interface Probe {
  path: string;
  id?: string;
}
interface Coverage {
  read: Probe;
  // La auditoría comercial no tiene escritura: solo la agregan los casos de uso.
  write: Probe | null;
}

// Una ruta representativa de lectura y otra de escritura para cada tipo de recurso del criterio 2.
// Las rutas sin id son listados: se comprueba que no traigan nada del comercio A.
const RESOURCES: Record<string, Coverage> = {
  comercio: {
    read: { path: '/plataforma/comercios/:id', id: TENANT_A },
    write: { path: '/plataforma/comercios/:id', id: TENANT_A },
  },
  sucursal: {
    read: { path: '/organizacion/estructura' },
    write: { path: '/organizacion/sucursales/:id', id: BRANCH_CENTRO },
  },
  caja: {
    read: { path: '/caja/sucursales/:id/cajas', id: BRANCH_CENTRO },
    write: { path: '/organizacion/cajas/:id', id: REGISTER_A },
  },
  usuario: {
    read: { path: '/organizacion/usuarios' },
    write: { path: '/organizacion/usuarios/:id/roles', id: USERS.vo.id },
  },
  producto: {
    read: { path: '/catalogo/productos/:id/imagen', id: PRODUCT_A },
    write: { path: '/catalogo/productos/:id', id: PRODUCT_A },
  },
  categoría: {
    read: { path: '/catalogo/categorias' },
    write: { path: '/catalogo/categorias/:id', id: CATEGORY_A },
  },
  combo: {
    read: { path: '/catalogo/combos' },
    write: { path: '/catalogo/combos/:id', id: PRODUCT_A },
  },
  'lista de precios': {
    read: { path: '/catalogo/listas/:id/precios', id: PRICE_LIST_A },
    write: { path: '/catalogo/listas/:id', id: PRICE_LIST_A },
  },
  promoción: {
    read: { path: '/promociones' },
    write: { path: '/promociones/:id', id: PROMOTION_A },
  },
  proveedor: {
    read: { path: '/proveedores' },
    write: { path: '/proveedores/:id', id: SUPPLIER_A },
  },
  compra: {
    read: { path: '/compras/:id', id: PURCHASE_A },
    write: { path: '/compras/:id/recepcion', id: PURCHASE_A },
  },
  'pago a proveedor': {
    read: { path: '/proveedores/:id/cuenta', id: SUPPLIER_A },
    write: { path: '/proveedores/:id/pagos', id: SUPPLIER_A },
  },
  inventario: {
    read: { path: '/inventario/sucursales/:id/stock', id: BRANCH_CENTRO },
    write: { path: '/inventario/sucursales/:id/ajustes', id: BRANCH_CENTRO },
  },
  transferencia: {
    read: { path: '/inventario/transferencias/:id', id: TRANSFER_A },
    write: { path: '/inventario/transferencias/:id/cancelacion', id: TRANSFER_A },
  },
  cliente: {
    read: { path: '/clientes' },
    write: { path: '/clientes/:id', id: CUSTOMER_A },
  },
  'cuenta corriente': {
    read: { path: '/cuenta-corriente/cobros' },
    write: { path: '/clientes/:id/cobros', id: CUSTOMER_A },
  },
  venta: {
    read: { path: '/ventas/:id', id: SALE_A },
    write: { path: '/ventas/:id/items', id: SALE_A },
  },
  pago: {
    read: { path: '/ventas/:id/ticket', id: SALE_A },
    write: { path: '/ventas/:id/pagos', id: SALE_A },
  },
  devolución: {
    read: { path: '/devoluciones/tickets/:numero' },
    write: { path: '/devoluciones/ventas/:id', id: SALE_A },
  },
  'Nota de Crédito': {
    read: { path: '/fiscal/comprobantes' },
    write: { path: '/fiscal/comprobantes/:id/reenvio', id: CREDIT_NOTE_A },
  },
  'comprobante fiscal': {
    read: { path: '/fiscal/comprobantes' },
    write: { path: '/fiscal/comprobantes/:id/reenvio', id: VOUCHER_A },
  },
  turno: {
    read: { path: '/caja/sucursales/:id/turnos-abiertos', id: BRANCH_CENTRO },
    write: { path: '/caja/turnos/:id/cierre-forzado', id: SHIFT_A },
  },
  'movimiento de caja': {
    read: { path: '/caja/sucursales/:id/turnos-abiertos', id: BRANCH_CENTRO },
    write: { path: '/caja/turno/ingresos' },
  },
  cierre: {
    read: { path: '/reportes/sucursales/:id/informe-diario', id: BRANCH_CENTRO },
    write: { path: '/caja/cajas/:id/corte-z', id: REGISTER_A },
  },
  'auditoría comercial': {
    read: { path: '/auditoria-comercial' },
    write: null,
  },
  'ticket de soporte': {
    read: { path: '/soporte/tickets/:id', id: SUPPORT_TICKET_A },
    write: { path: '/plataforma/tickets/:id/respuestas', id: SUPPORT_TICKET_A },
  },
};

// Todo lo que identifica al comercio A: nunca puede aparecer en una respuesta al comercio B.
const FOREIGN_MARKS = [
  TENANT_A,
  BRANCH_CENTRO,
  REGISTER_A,
  CATEGORY_A,
  PRODUCT_A,
  PRICE_LIST_A,
  PROMOTION_A,
  SUPPLIER_A,
  PURCHASE_A,
  TRANSFER_A,
  CUSTOMER_A,
  COLLECTION_A,
  SALE_A,
  SHIFT_A,
  VOUCHER_A,
  CREDIT_NOTE_A,
  SUPPORT_TICKET_A,
  USERS.vo.id,
];

const fill = (probe: Probe) =>
  probe.path.replace(':id', probe.id ?? '').replace(':numero', String(CONFIRMED_TICKET_NUMBER_A));

const bodyOf = (path: string): object => {
  if (path === '/caja/turno/ingresos') return { monto: '1', motivo: 'Intrusión' };
  if (path === '/plataforma/tickets/:id/respuestas') return { texto: 'Intrusión' };
  if (path === '/inventario/sucursales/:id/ajustes') {
    return { productoId: PRODUCT_A, cantidad: '1', motivo: 'Intrusión' };
  }
  return bodyFor(path);
};

describe('[RF-001] [RF-002] cada tipo de recurso del criterio 2', () => {
  const criterion = /Los tipos de recurso son: (.+?)\. Las notificaciones/.exec(SPEC)?.[1] ?? '';
  const specTypes = criterion
    .replace(' y ticket de soporte', ', ticket de soporte')
    .split(', ')
    .map((name) => name.trim());

  it('la tabla cubre exactamente los tipos del spec', () => {
    expect(specTypes.length).toBeGreaterThanOrEqual(26);
    expect(Object.keys(RESOURCES).sort()).toEqual([...specTypes].sort());
  });

  const reads = Object.entries(RESOURCES).map(([type, coverage]) => ({
    type,
    probe: coverage.read,
  }));
  const writes = Object.entries(RESOURCES).flatMap(([type, coverage]) =>
    coverage.write ? [{ type, probe: coverage.write }] : [],
  );

  // Con un id (o el número de un ticket) la ruta responde como inexistente. Las rutas de plataforma
  // se rechazan antes, por el rol. Un listado responde, pero solo con datos propios.
  function expectRejected(probe: Probe, response: request.Response) {
    if (probe.path.startsWith('/plataforma/')) {
      expect(response.status).toBe(403);
    } else if (probe.path.includes(':')) {
      expect(response.status).toBe(404);
    }
    expect(response.status).toBeLessThan(500);
    const text = JSON.stringify(response.body);
    for (const mark of FOREIGN_MARKS) expect(text).not.toContain(mark);
  }

  it.each(reads)('$type: otro comercio no lo lee', async ({ probe }) => {
    const route = routeFor(probe.path, true);
    const intruder = intruderFor(route.action);
    const auth = (await signIn(api.app, intruder.email)).authorization;

    const response = await request(api.app).get(fill(probe)).set('Authorization', auth);

    expectRejected(probe, response);
  });

  it.each(writes)('$type: otro comercio no lo modifica', async ({ probe }) => {
    const route = routeFor(probe.path, false);
    const intruder = intruderFor(route.action);
    const auth = (await signIn(api.app, intruder.email)).authorization;

    const response = await request(api.app)
      [route.method](fill(probe))
      .set('Authorization', auth)
      .send(bodyOf(probe.path));

    expectRejected(probe, response);
    expect(response.status).toBeGreaterThanOrEqual(400);
    // Un rechazo por el formato del cuerpo no probaría nada.
    expect(response.status).not.toBe(400);
  });

  const denials = [
    ...reads.map((c) => ({ ...c, read: true })),
    ...writes.map((c) => ({ ...c, read: false })),
  ];

  it.each(denials)(
    '$type ($probe.path): los roles sin permiso reciben 403',
    async ({ probe, read }) => {
      const route = routeFor(probe.path, read);
      const rules = rolesOf(route.action);
      const denied = ROLES.filter((role) => rules[role] === undefined);
      expect(denied.length).toBeGreaterThan(0);

      for (const role of denied) {
        const auth = (await signIn(api.app, EMAIL_BY_ROLE[role], role)).authorization;
        const response = await request(api.app)
          [route.method](fill(probe))
          .set('Authorization', auth);
        expect(response.status, `rol ${role}`).toBe(403);
      }
    },
  );

  it('el SA no lee ni modifica ningún recurso comercial', async () => {
    const auth = (await signIn(api.app, USERS.sa.email, 'SA')).authorization;
    const commercial = denials.filter(({ probe }) => !probe.path.startsWith('/plataforma/'));
    expect(commercial.length).toBeGreaterThan(40);

    for (const { probe, read } of commercial) {
      const route = routeFor(probe.path, read);
      const response = await request(api.app)[route.method](fill(probe)).set('Authorization', auth);
      expect(response.status, probe.path).toBe(403);
    }
  });

  it('la auditoría comercial no tiene ninguna ruta de escritura', () => {
    const writesToAudit = api.routes.filter(
      (route) => route.path.startsWith('/auditoria-comercial') && route.method !== 'get',
    );
    expect(writesToAudit).toEqual([]);
  });
});

describe('[RF-001] los listados solo traen datos del propio comercio', () => {
  const listRoutes = api.routes.filter(
    (route) =>
      route.method === 'get' &&
      route.action !== undefined &&
      !route.path.includes(':') &&
      !route.path.startsWith('/plataforma/') &&
      !route.path.startsWith('/simulador/'),
  );
  // Filtros con ids ajenos: tampoco pueden abrir la puerta a otro comercio.
  const FOREIGN_QUERY = `?sucursalId=${BRANCH_CENTRO}&proveedorId=${SUPPLIER_A}&q=A`;

  it('hay listados para probar', () => {
    expect(listRoutes.length).toBeGreaterThan(20);
  });

  it.each(listRoutes)('GET $path', async (route) => {
    const intruder = intruderFor(route.action ?? '');
    const auth = (await signIn(api.app, intruder.email)).authorization;

    for (const suffix of ['', FOREIGN_QUERY]) {
      const response = await request(api.app)
        .get(`${route.path}${suffix}`)
        .set('Authorization', auth);

      expect(response.status).toBeLessThan(500);
      const text = JSON.stringify(response.body);
      for (const mark of FOREIGN_MARKS) expect(text, `${route.path}${suffix}`).not.toContain(mark);
    }
  });

  it('el mismo listado sí trae los datos a su propio comercio', async () => {
    // Testigo: sin esto, las pruebas anteriores pasarían también con listados siempre vacíos.
    const ownAc = (await signIn(api.app, USERS.ac.email, 'AC')).authorization;
    const suppliers = await request(api.app).get('/proveedores').set('Authorization', ownAc);
    expect(JSON.stringify(suppliers.body)).toContain(SUPPLIER_A);
    const ownAs = (await signIn(api.app, USERS.asVo.email, 'AS')).authorization;
    const customers = await request(api.app).get('/clientes').set('Authorization', ownAs);
    expect(JSON.stringify(customers.body)).toContain(CUSTOMER_A);
  });
});

describe('[RF-001] las escrituras no aceptan referencias a recursos de otro comercio', () => {
  const cases = [
    {
      name: 'abrir un turno en una caja ajena',
      user: USERS.voB,
      path: '/caja/turnos',
      body: { cajaId: REGISTER_A, saldoInicial: '0' },
    },
    {
      name: 'registrar una compra a un proveedor ajeno',
      user: USERS.acB,
      path: '/compras',
      body: {
        proveedorId: SUPPLIER_A,
        sucursalId: BRANCH_B,
        items: [{ productoId: PRODUCT_A, cantidad: '1', costoUnitario: '1' }],
      },
    },
    {
      name: 'transferir stock a una sucursal ajena',
      user: USERS.asB,
      path: '/inventario/transferencias',
      body: {
        origenId: BRANCH_B,
        destinoId: BRANCH_CENTRO,
        items: [{ productoId: PRODUCT_A, cantidad: '1' }],
      },
    },
    {
      name: 'facturar después el ticket de otro comercio',
      user: USERS.acB,
      path: '/fiscal/facturacion-posterior',
      body: { numeroTicket: CONFIRMED_TICKET_NUMBER_A },
    },
  ] as const;

  it.each(cases)('$name se rechaza', async ({ user, path, body }) => {
    const auth = (await signIn(api.app, user.email)).authorization;

    const response = await request(api.app).post(path).set('Authorization', auth).send(body);

    expect([403, 404, 409]).toContain(response.status);
    const text = JSON.stringify(response.body);
    for (const mark of FOREIGN_MARKS) expect(text).not.toContain(mark);
  });

  it('la búsqueda de un ticket de otro comercio responde como inexistente', async () => {
    await ownerQuery(
      `UPDATE venta SET estado_comercial = 'confirmada', numero_ticket = $1, confirmada_en = now(),
         estado_cobro = 'pagada', estado_fiscal = 'no_se_factura', se_factura = false
       WHERE id = $2`,
      [CONFIRMED_TICKET_NUMBER_A, SALE_A],
    );
    const auth = (await signIn(api.app, USERS.voB.email)).authorization;

    const response = await request(api.app)
      .get(`/devoluciones/tickets/${String(CONFIRMED_TICKET_NUMBER_A)}`)
      .set('Authorization', auth);

    expect(response.status).toBe(404);
  });

  it('un movimiento de caja de otro comercio no toca la caja del comercio A', async () => {
    const auth = (await signIn(api.app, USERS.voB.email)).authorization;
    await request(api.app)
      .post('/caja/turno/ingresos')
      .set('Authorization', auth)
      .send({ monto: '1', motivo: 'Intrusión' });

    const rows = await ownerSelect('SELECT id FROM movimiento_caja WHERE tenant_id = $1', [
      TENANT_A,
    ]);
    expect(rows).toEqual([]);
  });
});
