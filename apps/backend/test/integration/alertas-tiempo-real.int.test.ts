// Alertas por destinatario, recordatorios de las persistentes y avisos en vivo por WebSocket
// (T-227 a T-229; RF-041, RF-061, RF-098, RF-127, D-91, AD-06).
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PgRealtimeFeed } from '../../src/modulos/alertas/adaptadores/postgres.js';
import type { RealtimeGateway } from '../../src/modulos/alertas/adaptadores/realtime-gateway.js';
import { createTestApi, TEST_FRONTEND_ORIGIN } from '../support/app.js';
import { expectToMatchContract } from '../support/contract.js';
import { appConnection, ownerQuery, ownerSelect } from '../support/database.js';
import {
  BRANCH_B,
  BRANCH_CENTRO,
  BRANCH_NORTE,
  seedIdentity,
  signIn,
  TENANT_A,
  TENANT_B,
  USERS,
} from '../support/identity-fixtures.js';
import { createMemoryLogger } from '../support/logger.js';

const api = createTestApi();

const AGUA = 'a5000000-0000-4000-8000-000000000001';
const AGUA_B = 'b5000000-0000-4000-8000-000000000001';
const BEBIDAS = 'a4000000-0000-4000-8000-000000000001';
const BEBIDAS_B = 'b4000000-0000-4000-8000-000000000001';

let server: Server;
let gateway: RealtimeGateway;
let url: string;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  server = createServer(api.app);
  gateway = api.alerts.realtime(new PgRealtimeFeed(appConnection(), createMemoryLogger()), {
    recheckMs: 150,
    authTimeoutMs: 300,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  await gateway.attach(server);
  url = `ws://127.0.0.1:${String((server.address() as AddressInfo).port)}/tiempo-real`;
});

afterAll(async () => {
  await gateway.close();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  await api.close();
});

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.terminate();
});

let ac: string;
let as: string;
let asNorte: string;
let vo: string;
let acB: string;

beforeEach(async () => {
  api.clock.set('2026-11-02T12:00:00Z');
  await seedIdentity();
  await ownerQuery(
    `INSERT INTO categoria (id, tenant_id, nombre, tasa_iva, creado_en)
     VALUES ($1, $2, 'Bebidas', 21, now()), ($3, $4, 'Bebidas', 21, now())`,
    [BEBIDAS, TENANT_A, BEBIDAS_B, TENANT_B],
  );
  await ownerQuery(
    `INSERT INTO producto (id, tenant_id, tipo, nombre, categoria_id, costo, creado_en)
     VALUES ($1, $2, 'simple', 'Agua', $3, 100, now()), ($4, $5, 'simple', 'Agua', $6, 100, now())`,
    [AGUA, TENANT_A, BEBIDAS, AGUA_B, TENANT_B, BEBIDAS_B],
  );
  ac = (await signIn(api.app, USERS.ac.email, 'AC')).authorization;
  as = (await signIn(api.app, USERS.asVo.email, 'AS')).authorization;
  asNorte = (await signIn(api.app, USERS.asNorte.email, 'AS')).authorization;
  vo = (await signIn(api.app, USERS.vo.email, 'VO')).authorization;
  acB = (await signIn(api.app, USERS.acB.email, 'AC')).authorization;
});

const get = (path: string, token: string) => request(api.app).get(path).set('Authorization', token);
const post = (path: string, token: string, body: object = {}) =>
  request(api.app).post(path).set('Authorization', token).send(body);

interface AlertSeed {
  role: 'AC' | 'AS' | 'VO';
  branch?: string | null;
  type?: string;
  severity?: 'info' | 'advertencia' | 'critica';
  persistent?: boolean;
  createdAt?: string;
  tenant?: string;
}

async function alert(seed: AlertSeed): Promise<string> {
  const id = randomUUID();
  await ownerQuery(
    `INSERT INTO alerta (id, tenant_id, sucursal_id, destinatario_rol, tipo, severidad,
       persistente, detalle, creada_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '{}', $8)`,
    [
      id,
      seed.tenant ?? TENANT_A,
      seed.branch === undefined ? BRANCH_CENTRO : seed.branch,
      seed.role,
      seed.type ?? 'transferencia_faltante',
      seed.severity ?? 'advertencia',
      seed.persistent ?? false,
      seed.createdAt ?? '2026-11-02T10:00:00Z',
    ],
  );
  return id;
}

const ids = (body: unknown) => (body as { id: string }[]).map((a) => a.id);

describe('[RF-041] [RF-098] alertas por destinatario (T-227)', () => {
  it('el AS ve las de su sucursal y no las del AS de otra sucursal', async () => {
    const centro = await alert({ role: 'AS' });
    const norte = await alert({ role: 'AS', branch: BRANCH_NORTE });
    await alert({ role: 'AC', branch: null });
    await alert({ role: 'AS', tenant: TENANT_B, branch: BRANCH_B });

    const mine = await get('/alertas', asNorte);
    expect(mine.status).toBe(200);
    expectToMatchContract(mine, 'get', '/alertas');
    expect(ids(mine.body)).toEqual([norte]);
    // El AS de Centro y Norte ve las dos; filtra por sucursal si quiere.
    expect(ids((await get('/alertas', as)).body).sort()).toEqual([centro, norte].sort());
    expect(ids((await get(`/alertas?sucursalId=${BRANCH_CENTRO}`, as)).body)).toEqual([centro]);
  });

  it('el AS no filtra por una sucursal fuera de su ámbito', async () => {
    const response = await get(`/alertas?sucursalId=${BRANCH_CENTRO}`, asNorte);
    expect(response.status).toBe(403);
  });

  it('el AC ve las del AC de todo el comercio; el VO no ve las del AS', async () => {
    const forAc = await alert({ role: 'AC', branch: null });
    await alert({ role: 'AS' });
    expect(ids((await get('/alertas', ac)).body)).toEqual([forAc]);
    expect(ids((await get('/alertas', vo)).body)).toEqual([]);
    expect(ids((await get('/alertas', acB)).body)).toEqual([]);
  });

  it('el AC no consulta una sucursal de otro comercio', async () => {
    expect((await get(`/alertas?sucursalId=${BRANCH_B}`, ac)).status).toBe(404);
  });
});

describe('[RF-189] resumen de alertas para el indicador', () => {
  it('cuenta las pendientes del ámbito y trae la más grave', async () => {
    const empty = await get('/alertas/resumen', asNorte);
    expectToMatchContract(empty, 'get', '/alertas/resumen');
    expect(empty.body).toEqual({ cantidad: 0, severidadMaxima: null });

    await alert({ role: 'AS', branch: BRANCH_NORTE, severity: 'info' });
    const critical = await alert({ role: 'AS', branch: BRANCH_NORTE, severity: 'critica' });
    await alert({ role: 'AS', severity: 'critica', type: 'otra' });
    await alert({ role: 'AS', tenant: TENANT_B, branch: BRANCH_B, severity: 'critica' });

    expect((await get('/alertas/resumen', asNorte)).body).toEqual({
      cantidad: 2,
      severidadMaxima: 'critica',
    });
    await ownerQuery('UPDATE alerta SET resuelta_en = now() WHERE id = $1', [critical]);
    expect((await get('/alertas/resumen', asNorte)).body).toEqual({
      cantidad: 1,
      severidadMaxima: 'info',
    });
  });
});

describe('[RF-127] resolver una alerta (D-91)', () => {
  it('la resuelve un AS y queda resuelta para todos los AS, con quién la resolvió', async () => {
    const id = await alert({ role: 'AS', branch: BRANCH_NORTE });
    const resolved = await post(`/alertas/${id}/resolucion`, asNorte, {});
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(204);
    expectToMatchContract(resolved, 'post', '/alertas/{id}/resolucion');
    expect(ids((await get('/alertas', as)).body)).toEqual([]);
    const [row] = await ownerSelect<{ resuelta_por: string }>(
      'SELECT resuelta_por FROM alerta WHERE id = $1',
      [id],
    );
    expect(row?.resuelta_por).toBe(USERS.asNorte.id);
    expect((await post(`/alertas/${id}/resolucion`, as, {})).body).toMatchObject({
      codigo: 'ALERTA_RESUELTA',
    });
  });

  it('una crítica exige nota y queda en la auditoría comercial', async () => {
    const id = await alert({
      role: 'AC',
      branch: BRANCH_CENTRO,
      type: 'reintegro_pendiente',
      severity: 'critica',
    });
    const withoutNote = await post(`/alertas/${id}/resolucion`, ac, {});
    expect(withoutNote.status).toBe(409);
    expect(withoutNote.body).toMatchObject({ codigo: 'NOTA_REQUERIDA' });

    const withNote = await post(`/alertas/${id}/resolucion`, ac, {
      nota: 'Reintegrado por transferencia',
    });
    expect(withNote.status).toBe(204);
    const [row] = await ownerSelect<{ detalle: { resolucion: string } }>(
      'SELECT detalle FROM alerta WHERE id = $1',
      [id],
    );
    expect(row?.detalle.resolucion).toBe('Reintegrado por transferencia');
    const audit = await ownerSelect<{ usuario_id: string; entidad_id: string }>(
      "SELECT usuario_id, entidad_id FROM auditoria_comercial WHERE accion = 'alerta.resolver'",
    );
    expect(audit).toEqual([{ usuario_id: USERS.ac.id, entidad_id: id }]);
  });

  it('las que se resuelven solas no se descartan', async () => {
    const id = await alert({ role: 'AS', type: 'stock_minimo' });
    const response = await post(`/alertas/${id}/resolucion`, as, {});
    expect(response.body).toMatchObject({ codigo: 'ALERTA_NO_DESCARTABLE' });
    const listed = (await get('/alertas', as)).body as { resolubleAMano: boolean }[];
    expect(listed).toMatchObject([{ resolubleAMano: false }]);
  });

  it('la alerta de otra sucursal o de otro comercio responde como inexistente', async () => {
    const centro = await alert({ role: 'AS' });
    const other = await alert({ role: 'AS', tenant: TENANT_B, branch: BRANCH_B });
    expect((await post(`/alertas/${centro}/resolucion`, asNorte, {})).status).toBe(404);
    expect((await post(`/alertas/${other}/resolucion`, as, {})).status).toBe(404);
    expect((await post(`/alertas/${centro}/resolucion`, vo, {})).status).toBe(404);
  });
});

describe('recordatorios de las persistentes (T-227, D-91)', () => {
  const reminders = async (id: string) =>
    (
      await ownerSelect<{
        recordatorios: number | null;
        ultimo_recordatorio: Date | null;
        proximo_recordatorio: Date | null;
      }>(
        `SELECT (detalle->>'recordatorios')::int AS recordatorios, ultimo_recordatorio,
                proximo_recordatorio
           FROM alerta WHERE id = $1`,
        [id],
      )
    )[0];

  it('recuerda cada 24 horas las persistentes sin resolver y las pone primero', async () => {
    const old = await alert({ role: 'AS', persistent: true, createdAt: '2026-11-01T11:00:00Z' });
    const recent = await alert({ role: 'AS', persistent: true, createdAt: '2026-11-02T11:00:00Z' });
    const normal = await alert({ role: 'AS', createdAt: '2026-11-01T11:00:00Z' });
    const fresh = await alert({ role: 'AS', createdAt: '2026-11-02T11:30:00Z' });

    expect(await api.alerts.reminders.sweep()).toBe(1);
    expect(await reminders(old)).toEqual({
      recordatorios: 1,
      ultimo_recordatorio: new Date('2026-11-02T12:00:00Z'),
      proximo_recordatorio: new Date('2026-11-03T12:00:00Z'),
    });
    expect((await reminders(recent))?.recordatorios).toBeNull();
    expect((await reminders(normal))?.recordatorios).toBeNull();
    // La recordada vuelve al principio.
    expect(ids((await get('/alertas', as)).body)).toEqual([old, fresh, recent, normal]);

    // Una segunda pasada en el mismo período no repite.
    expect(await api.alerts.reminders.sweep()).toBe(0);
    api.clock.set('2026-11-03T12:00:00Z');
    expect(await api.alerts.reminders.sweep()).toBe(2);
    expect((await reminders(old))?.recordatorios).toBe(2);
  });

  it('una resuelta ya no se recuerda', async () => {
    const id = await alert({ role: 'AS', persistent: true, createdAt: '2026-11-01T11:00:00Z' });
    await post(`/alertas/${id}/resolucion`, as, {});
    expect(await api.alerts.reminders.sweep()).toBe(0);
  });
});

// Cliente WebSocket de prueba que guarda los mensajes recibidos.
interface Client {
  socket: WebSocket;
  messages: Record<string, unknown>[];
  closed: Promise<number>;
}

function connect(origin: string | null = TEST_FRONTEND_ORIGIN): Promise<Client> {
  const socket = new WebSocket(url, origin === null ? {} : { origin });
  sockets.push(socket);
  const messages: Record<string, unknown>[] = [];
  socket.on('message', (raw: Buffer) => {
    messages.push(JSON.parse(raw.toString('utf8')) as Record<string, unknown>);
  });
  const closed = new Promise<number>((resolve) => {
    socket.on('close', (code) => {
      resolve(code);
    });
  });
  return new Promise((resolve, reject) => {
    socket.on('open', () => {
      resolve({ socket, messages, closed });
    });
    socket.on('error', reject);
  });
}

async function waitFor(
  client: Client,
  tipo: string,
  match: (message: Record<string, unknown>) => boolean = () => true,
  timeoutMs = 2000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = client.messages.find((m) => m.tipo === tipo && match(m));
    if (found) return { message: found, elapsed: Date.now() - started };
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`No llegó un aviso "${tipo}" en ${String(timeoutMs)} ms.`);
}

const tokenOf = (authorization: string) => authorization.replace(/^Bearer /, '');

async function subscribe(authorization: string, sucursalId: string | null = null) {
  const client = await connect();
  client.socket.send(
    JSON.stringify({ tipo: 'autenticar', token: tokenOf(authorization), sucursalId }),
  );
  await waitFor(client, 'listo');
  return client;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('[RF-061] canal en vivo autenticado (T-228)', () => {
  it('sin autenticarse a tiempo, la conexión se cierra', async () => {
    const client = await connect();
    expect(await client.closed).toBe(4401);
  });

  it('un token inválido se rechaza', async () => {
    const client = await connect();
    client.socket.send(JSON.stringify({ tipo: 'autenticar', token: 'a.b.c' }));
    expect(await client.closed).toBe(4401);
  });

  it('un mensaje mal formado se rechaza', async () => {
    const client = await connect();
    client.socket.send('hola');
    expect(await client.closed).toBe(4400);
  });

  it('el VO no se suscribe a otra sucursal y el AC no a una de otro comercio', async () => {
    const intruder = await connect();
    intruder.socket.send(
      JSON.stringify({ tipo: 'autenticar', token: tokenOf(vo), sucursalId: BRANCH_NORTE }),
    );
    expect(await intruder.closed).toBe(4403);

    const foreign = await connect();
    foreign.socket.send(
      JSON.stringify({ tipo: 'autenticar', token: tokenOf(ac), sucursalId: BRANCH_B }),
    );
    expect(await foreign.closed).toBe(4404);
  });

  it('un origen que no es el frontend no abre la conexión', async () => {
    await expect(connect('https://intruso.example')).rejects.toThrow(/403/);
  });

  it('al cerrar la sesión, la conexión se corta', async () => {
    const client = await subscribe(vo, BRANCH_CENTRO);
    await post('/auth/cerrar-sesion', vo);
    expect(await client.closed).toBe(4401);
  });

  it('el token renovado tiene que ser de la misma sesión', async () => {
    const client = await subscribe(vo, BRANCH_CENTRO);
    client.socket.send(JSON.stringify({ tipo: 'token', token: tokenOf(as) }));
    expect(await client.closed).toBe(4401);
  });
});

describe('[RF-061] difusión de los cambios de stock (T-229)', () => {
  it('llega en 2 segundos a la misma sucursal y nunca a otra ni a otro comercio', async () => {
    const centro = await subscribe(vo, BRANCH_CENTRO);
    const norte = await subscribe(asNorte, BRANCH_NORTE);
    const otherTenant = await subscribe(acB, BRANCH_B);
    const alertsOnly = await subscribe(as);

    const adjusted = await post(`/inventario/sucursales/${BRANCH_CENTRO}/ajustes`, as, {
      productoId: AGUA,
      cantidad: '5',
      motivo: 'Conteo',
    });
    expect(adjusted.status, JSON.stringify(adjusted.body)).toBe(200);

    const { message, elapsed } = await waitFor(centro, 'stock', (m) => m.disponible === '5.000');
    expect(message).toEqual({ tipo: 'stock', productoId: AGUA, disponible: '5.000' });
    expect(elapsed).toBeLessThan(2000);
    await pause(300);
    expect(norte.messages.filter((m) => m.tipo === 'stock')).toEqual([]);
    expect(otherTenant.messages.filter((m) => m.tipo === 'stock')).toEqual([]);
    expect(alertsOnly.messages.filter((m) => m.tipo === 'stock')).toEqual([]);
  });

  it('un cambio que se revierte no se avisa', async () => {
    const centro = await subscribe(vo, BRANCH_CENTRO);
    const failed = await post(`/inventario/sucursales/${BRANCH_CENTRO}/ajustes`, as, {
      productoId: AGUA,
      cantidad: '-5',
      motivo: 'Conteo',
    });
    expect(failed.status).toBe(409);
    await pause(300);
    expect(centro.messages.filter((m) => m.tipo === 'stock')).toEqual([]);
  });

  it('las alertas nuevas avisan solo a los de su rol y sucursal', async () => {
    const acClient = await subscribe(ac);
    const asCentro = await subscribe(as);
    const asNorteClient = await subscribe(asNorte);
    const voClient = await subscribe(vo, BRANCH_CENTRO);

    await alert({ role: 'AS', branch: BRANCH_CENTRO });
    await waitFor(asCentro, 'alertas');
    await pause(300);
    expect(asNorteClient.messages.filter((m) => m.tipo === 'alertas')).toEqual([]);
    expect(acClient.messages.filter((m) => m.tipo === 'alertas')).toEqual([]);
    expect(voClient.messages.filter((m) => m.tipo === 'alertas')).toEqual([]);

    await alert({ role: 'AC', branch: null });
    await waitFor(acClient, 'alertas');
  });
});
