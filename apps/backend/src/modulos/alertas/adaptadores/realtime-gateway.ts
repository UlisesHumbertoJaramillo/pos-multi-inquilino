// Gateway WebSocket de los avisos en vivo (T-228, T-229; RF-061, AD-06, Const. 16).
// Protocolo:
// - El cliente abre /tiempo-real y, dentro de 5 segundos, envía
//   {"tipo":"autenticar","token":"…","sucursalId":"…"}. El token va en un mensaje y no en la URL,
//   para que nunca quede en un registro de accesos.
// - El servidor verifica el token y la sesión, y decide la suscripción: el stock de la sucursal
//   pedida (si está en el ámbito del usuario) y las alertas de su rol. Responde {"tipo":"listo"}.
// - Antes de que venza el token, el cliente envía {"tipo":"token","token":"…"} con el renovado.
// - Avisos: {"tipo":"stock","productoId","disponible"} y {"tipo":"alertas"} (pedir GET /alertas).
// Cierres: 4400 mensaje inválido, 4401 sin sesión válida, 4403 sin permiso, 4404 sucursal
// inexistente.
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import type { AccessTokens } from '../../../compartido/aplicacion/access-tokens.js';
import { ApplicationError } from '../../../compartido/aplicacion/errors.js';
import type { Logger } from '../../../compartido/aplicacion/logger.js';
import type { SecurityContext } from '../../../compartido/aplicacion/security-context.js';
import type { SessionStatus } from '../../../compartido/aplicacion/session-status.js';
import type { AuthorizeRealtime, RealtimeSubscription } from '../aplicacion/alerts.js';
import type { RealtimeFeed, RealtimeNotice } from '../aplicacion/ports.js';
import { isVisibleTo } from '../dominio/alerts.js';

export const REALTIME_PATH = '/tiempo-real';

export const CLOSE = {
  invalid: 4400,
  unauthenticated: 4401,
  forbidden: 4403,
  notFound: 4404,
} as const;

export interface RealtimeGatewayOptions {
  tokens: AccessTokens;
  sessions: SessionStatus;
  authorize: AuthorizeRealtime;
  feed: RealtimeFeed;
  allowedOrigins: readonly string[];
  logger: Logger;
  authTimeoutMs?: number;
  // Cada cuánto se vuelve a verificar el token y la sesión de cada conexión.
  recheckMs?: number;
}

interface Connection {
  socket: WebSocket;
  token: string | null;
  context: SecurityContext | null;
  subscription: RealtimeSubscription | null;
  alive: boolean;
}

const MAX_MESSAGE_BYTES = 4 * 1024;
const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ClientMessage =
  | { tipo: 'autenticar'; token: string; sucursalId: string | null }
  | { tipo: 'token'; token: string };

function parseMessage(raw: RawData): ClientMessage | null {
  let data: unknown;
  try {
    const bytes = Buffer.isBuffer(raw)
      ? raw
      : Array.isArray(raw)
        ? Buffer.concat(raw)
        : Buffer.from(raw);
    data = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const message = data as Record<string, unknown>;
  if (typeof message.token !== 'string' || !JWT_SHAPE.test(message.token)) return null;
  if (message.tipo === 'token') return { tipo: 'token', token: message.token };
  if (message.tipo !== 'autenticar') return null;
  const branch = message.sucursalId ?? null;
  if (branch !== null && (typeof branch !== 'string' || !UUID.test(branch))) return null;
  return { tipo: 'autenticar', token: message.token, sucursalId: branch };
}

const sameSession = (a: SecurityContext, b: SecurityContext) =>
  a.userId === b.userId &&
  a.sessionId === b.sessionId &&
  a.tenantId === b.tenantId &&
  a.activeRole === b.activeRole;

export class RealtimeGateway {
  private readonly connections = new Set<Connection>();
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private readonly authTimeoutMs: number;
  private readonly recheckMs: number;
  private timer: NodeJS.Timeout | null = null;
  private server: HttpServer | HttpsServer | null = null;

  constructor(private readonly options: RealtimeGatewayOptions) {
    this.authTimeoutMs = options.authTimeoutMs ?? 5_000;
    this.recheckMs = options.recheckMs ?? 30_000;
  }

  private readonly onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== REALTIME_PATH) {
      socket.destroy();
      return;
    }
    // Un navegador siempre envía Origin: solo se aceptan los del frontend (evita que otro sitio
    // abra la conexión con la sesión del usuario).
    const origin = req.headers.origin;
    if (origin !== undefined && !this.options.allowedOrigins.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.accept(ws);
    });
  };

  async attach(server: HttpServer | HttpsServer): Promise<void> {
    this.server = server;
    server.on('upgrade', this.onUpgrade);
    await this.options.feed.start((notice) => {
      this.dispatch(notice);
    });
    this.timer = setInterval(() => {
      void this.recheck();
    }, this.recheckMs);
    this.timer.unref();
  }

  async close(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.server?.off('upgrade', this.onUpgrade);
    for (const connection of this.connections) connection.socket.terminate();
    this.connections.clear();
    await this.options.feed.stop();
    await new Promise<void>((resolve) => {
      this.wss.close(() => {
        resolve();
      });
    });
  }

  get size(): number {
    return this.connections.size;
  }

  private accept(socket: WebSocket) {
    const connection: Connection = {
      socket,
      token: null,
      context: null,
      subscription: null,
      alive: true,
    };
    this.connections.add(connection);
    const timeout = setTimeout(() => {
      if (connection.subscription === null) socket.close(CLOSE.unauthenticated, 'Sin autenticar');
    }, this.authTimeoutMs);
    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('message', (raw) => {
      void this.receive(connection, raw);
    });
    socket.on('close', () => {
      clearTimeout(timeout);
      this.connections.delete(connection);
    });
    socket.on('error', () => {
      socket.terminate();
    });
  }

  private async receive(connection: Connection, raw: RawData) {
    const message = parseMessage(raw);
    if (!message) {
      connection.socket.close(CLOSE.invalid, 'Mensaje inválido');
      return;
    }
    try {
      if (message.tipo === 'autenticar') await this.authenticate(connection, message);
      else await this.renew(connection, message.token);
    } catch (error: unknown) {
      const code =
        error instanceof ApplicationError
          ? error.kind === 'forbidden'
            ? CLOSE.forbidden
            : error.kind === 'not_found'
              ? CLOSE.notFound
              : CLOSE.unauthenticated
          : 1011;
      if (code === 1011) {
        this.options.logger.error('Error al autenticar una conexión en vivo', { err: error });
      }
      connection.socket.close(code, code === 1011 ? 'Error interno' : 'Rechazada');
    }
  }

  private async verify(token: string): Promise<SecurityContext | null> {
    const context = await this.options.tokens.verify(token);
    if (!context || !(await this.options.sessions.isActive(context))) return null;
    return context;
  }

  private async authenticate(
    connection: Connection,
    message: { token: string; sucursalId: string | null },
  ) {
    if (connection.token !== null) {
      connection.socket.close(CLOSE.invalid, 'Ya autenticada');
      return;
    }
    connection.token = message.token;
    const context = await this.verify(message.token);
    if (!context) {
      connection.socket.close(CLOSE.unauthenticated, 'Sesión no válida');
      return;
    }
    const subscription = await this.options.authorize.execute(context, message.sucursalId);
    connection.context = context;
    connection.subscription = subscription;
    this.send(connection, { tipo: 'listo', sucursalId: subscription.stockBranchId });
  }

  // El token renovado tiene que ser de la misma sesión, con el mismo comercio y rol.
  private async renew(connection: Connection, token: string) {
    const current = connection.context;
    const context = await this.verify(token);
    if (current === null || context === null || !sameSession(current, context)) {
      connection.socket.close(CLOSE.unauthenticated, 'Sesión no válida');
      return;
    }
    connection.token = token;
    connection.context = context;
  }

  // Token vencido, sesión cerrada o comercio suspendido: la conexión se corta. Las conexiones
  // que no responden al ping se descartan.
  private async recheck() {
    for (const connection of [...this.connections]) {
      if (!connection.alive) {
        connection.socket.terminate();
        continue;
      }
      connection.alive = false;
      connection.socket.ping();
      if (connection.token === null || connection.subscription === null) continue;
      try {
        if ((await this.verify(connection.token)) === null) {
          connection.socket.close(CLOSE.unauthenticated, 'Sesión vencida');
        }
      } catch (error: unknown) {
        this.options.logger.warn('No se pudo verificar una conexión en vivo', { err: error });
      }
    }
  }

  // Reparte un aviso solo a las conexiones suscritas a ese comercio y sucursal o rol.
  dispatch(notice: RealtimeNotice): void {
    for (const connection of this.connections) {
      const subscription = connection.subscription;
      if (subscription?.tenantId !== notice.tenantId) continue;
      if (notice.kind === 'stock') {
        if (subscription.stockBranchId !== notice.branchId) continue;
        this.send(connection, {
          tipo: 'stock',
          productoId: notice.productId,
          disponible: notice.available,
        });
      } else if (
        isVisibleTo(
          { recipientRole: notice.role, recipientId: null, branchId: notice.branchId },
          subscription.audience,
        )
      ) {
        this.send(connection, { tipo: 'alertas' });
      }
    }
  }

  private send(connection: Connection, message: Record<string, unknown>) {
    if (connection.socket.readyState === connection.socket.OPEN) {
      connection.socket.send(JSON.stringify(message));
    }
  }
}
