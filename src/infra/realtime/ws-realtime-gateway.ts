import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Logger } from 'pino';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { rooms } from './rooms.js';
import {
  RealtimeAuthError,
  type ConnectionAuthenticator,
  type RealtimeAuthorizer,
  type RealtimeEvent,
  type RealtimeGateway,
  type RealtimeHandshake,
  type RealtimePrincipal,
} from './types.js';

const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024; // 1 MiB

interface ConnectionState {
  id: string;
  principal: RealtimePrincipal;
  rooms: Set<string>;
  isAlive: boolean;
}

export interface WsRealtimeGatewayOptions {
  path: string;
  pingIntervalMs: number;
  logger: Logger;
  authenticator: ConnectionAuthenticator;
  authorizer: RealtimeAuthorizer;
  maxPayloadBytes?: number;
  /** Hard cap on concurrent connections for this node. 0 / undefined = no cap. */
  maxConnections?: number;
}

interface ClientMessage {
  type: string;
  data: Record<string, unknown>;
}

function decodeRaw(raw: RawData, isBinary: boolean): string | null {
  if (isBinary) return null;
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return Buffer.from(raw).toString('utf8');
}

function parseClientMessage(text: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.type !== 'string') return null;
  const data =
    typeof obj.data === 'object' && obj.data !== null ? (obj.data as Record<string, unknown>) : {};
  return { type: obj.type, data };
}

/**
 * WebSocket real-time gateway.
 *
 * - Shares the application's HTTP port (`noServer` + `upgrade` handling).
 * - Authenticates every connection via the injected {@link ConnectionAuthenticator}.
 * - Gates client `subscribe` requests via the injected {@link RealtimeAuthorizer}
 *   (same org-scoping rules as REST). Server-side emits are not gated.
 * - Heartbeats with ping/pong and terminates dead sockets.
 *
 * Single-node only. A multi-node deployment swaps this for an implementation
 * backed by a shared pub/sub (Redis) behind the same {@link RealtimeGateway}.
 */
export class WsRealtimeGateway implements RealtimeGateway {
  private readonly log: Logger;
  private readonly maxPayloadBytes: number;
  private readonly maxConnections: number;
  private wss: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  private readonly connections = new Map<WebSocket, ConnectionState>();
  private readonly roomIndex = new Map<string, Set<WebSocket>>();

  private readonly onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    this.handleUpgrade(req, socket, head);
  };

  constructor(private readonly options: WsRealtimeGatewayOptions) {
    this.log = options.logger.child({ component: 'realtime' });
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    this.maxConnections = options.maxConnections ?? 0;
  }

  private atCapacity(): boolean {
    return this.maxConnections > 0 && this.connections.size >= this.maxConnections;
  }

  isEnabled(): boolean {
    return true;
  }

  connectionCount(): number {
    return this.connections.size;
  }

  attach(server: HttpServer): void {
    if (this.wss) throw new Error('WsRealtimeGateway is already attached');
    this.httpServer = server;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: this.maxPayloadBytes });
    server.on('upgrade', this.onUpgrade);

    this.heartbeat = setInterval(() => this.sweep(), this.options.pingIntervalMs);
    this.heartbeat.unref();

    this.log.info({ path: this.options.path }, 'realtime gateway attached');
  }

  async close(): Promise<void> {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    this.httpServer?.off('upgrade', this.onUpgrade);

    for (const ws of this.connections.keys()) {
      try {
        ws.close(1001, 'server shutting down');
      } catch {
        ws.terminate();
      }
    }
    this.connections.clear();
    this.roomIndex.clear();

    const wss = this.wss;
    if (wss) {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
    this.wss = null;
    this.httpServer = null;
    this.log.info('realtime gateway closed');
  }

  emitToUser(userId: string, event: RealtimeEvent): void {
    this.emitToRoom(rooms.user(userId), event);
  }

  emitToRoom(room: string, event: RealtimeEvent): void {
    const set = this.roomIndex.get(room);
    if (!set || set.size === 0) return;
    const payload = JSON.stringify(this.wire(event));
    for (const ws of set) this.rawSend(ws, payload);
  }

  broadcast(event: RealtimeEvent): void {
    if (this.connections.size === 0) return;
    const payload = JSON.stringify(this.wire(event));
    for (const ws of this.connections.keys()) this.rawSend(ws, payload);
  }

  // --- connection lifecycle ------------------------------------------------

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const wss = this.wss;
    if (!wss) {
      socket.destroy();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== this.options.path) {
      // This app runs a single WebSocket endpoint; reject anything else so the
      // socket is not left hanging.
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    if (this.atCapacity()) {
      this.log.warn(
        { connections: this.connections.size, maxConnections: this.maxConnections },
        'realtime upgrade rejected — connection cap reached',
      );
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const handshake: RealtimeHandshake = {
      headers: req.headers,
      query: Object.fromEntries(url.searchParams.entries()),
      ip: req.socket.remoteAddress,
    };

    this.options.authenticator
      .authenticate(handshake)
      .then((principal) => {
        // Re-check: sockets may have connected while authentication was in flight.
        if (this.atCapacity()) {
          socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          this.registerConnection(ws, principal);
        });
      })
      .catch((err: unknown) => {
        const unauthorized = err instanceof RealtimeAuthError;
        this.log.debug({ err }, 'realtime upgrade rejected');
        socket.write(
          unauthorized
            ? 'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'
            : 'HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n',
        );
        socket.destroy();
      });
  }

  private registerConnection(ws: WebSocket, principal: RealtimePrincipal): void {
    const state: ConnectionState = {
      id: randomUUID(),
      principal,
      rooms: new Set<string>(),
      isAlive: true,
    };
    this.connections.set(ws, state);

    if (principal.userId) this.joinRoom(ws, rooms.user(principal.userId));

    ws.on('pong', () => {
      state.isAlive = true;
    });
    ws.on('message', (raw: RawData, isBinary: boolean) => {
      void this.handleMessage(ws, state, raw, isBinary);
    });
    ws.on('error', (err) => this.log.debug({ err, connId: state.id }, 'realtime socket error'));
    ws.on('close', () => this.cleanupConnection(ws));

    this.send(ws, {
      type: 'welcome',
      data: { connectionId: state.id, userId: principal.userId, rooms: [...state.rooms] },
    });
    this.log.debug({ connId: state.id, userId: principal.userId }, 'realtime connection opened');
  }

  private async handleMessage(
    ws: WebSocket,
    state: ConnectionState,
    raw: RawData,
    isBinary: boolean,
  ): Promise<void> {
    const text = decodeRaw(raw, isBinary);
    if (text === null) {
      this.send(ws, { type: 'error', data: { message: 'binary frames are not supported' } });
      return;
    }

    const message = parseClientMessage(text);
    if (!message) {
      this.send(ws, {
        type: 'error',
        data: { message: 'invalid message: expected { type, data }' },
      });
      return;
    }

    switch (message.type) {
      case 'ping':
        this.send(ws, { type: 'pong', data: {} });
        return;

      case 'subscribe': {
        const room = typeof message.data.room === 'string' ? message.data.room : null;
        if (!room) {
          this.send(ws, { type: 'error', data: { message: 'subscribe requires "room"' } });
          return;
        }
        const allowed = await this.options.authorizer.canSubscribe(state.principal, room);
        if (!allowed) {
          this.log.debug({ connId: state.id, room }, 'realtime subscribe denied');
          this.send(ws, { type: 'error', data: { message: 'subscription denied', room } });
          return;
        }
        this.joinRoom(ws, room);
        this.send(ws, { type: 'subscribed', data: { room } });
        return;
      }

      case 'unsubscribe': {
        const room = typeof message.data.room === 'string' ? message.data.room : null;
        if (!room) {
          this.send(ws, { type: 'error', data: { message: 'unsubscribe requires "room"' } });
          return;
        }
        this.leaveRoom(ws, room);
        this.send(ws, { type: 'unsubscribed', data: { room } });
        return;
      }

      default:
        this.send(ws, {
          type: 'error',
          data: { message: `unknown message type: ${message.type}` },
        });
    }
  }

  private cleanupConnection(ws: WebSocket): void {
    const state = this.connections.get(ws);
    if (state) {
      for (const room of state.rooms) {
        const set = this.roomIndex.get(room);
        if (!set) continue;
        set.delete(ws);
        if (set.size === 0) this.roomIndex.delete(room);
      }
      this.log.debug({ connId: state.id }, 'realtime connection closed');
    }
    this.connections.delete(ws);
  }

  private sweep(): void {
    for (const [ws, state] of this.connections) {
      if (!state.isAlive) {
        ws.terminate();
        this.cleanupConnection(ws);
        continue;
      }
      state.isAlive = false;
      try {
        ws.ping();
      } catch {
        // terminated on the next sweep if the ping cannot be sent
      }
    }
  }

  // --- room bookkeeping --------------------------------------------------

  private joinRoom(ws: WebSocket, room: string): void {
    const state = this.connections.get(ws);
    if (!state) return;
    state.rooms.add(room);
    const set = this.roomIndex.get(room) ?? new Set<WebSocket>();
    set.add(ws);
    this.roomIndex.set(room, set);
  }

  private leaveRoom(ws: WebSocket, room: string): void {
    this.connections.get(ws)?.rooms.delete(room);
    const set = this.roomIndex.get(room);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.roomIndex.delete(room);
  }

  // --- framing ----------------------------------------------------------

  private wire(event: RealtimeEvent): RealtimeEvent {
    return {
      type: event.type,
      data: event.data,
      meta: { emittedAt: new Date().toISOString(), ...event.meta },
    };
  }

  private send(ws: WebSocket, event: RealtimeEvent): void {
    this.rawSend(ws, JSON.stringify(this.wire(event)));
  }

  private rawSend(ws: WebSocket, payload: string): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(payload, (err) => {
      if (err) this.log.debug({ err }, 'realtime send failed');
    });
  }
}
