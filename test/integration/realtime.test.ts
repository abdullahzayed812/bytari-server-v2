import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { WebSocket } from 'ws';
import {
  RealtimeAuthError,
  WsRealtimeGateway,
  rooms,
  type ConnectionAuthenticator,
  type RealtimeAuthorizer,
  type RealtimeHandshake,
  type RealtimePrincipal,
} from '../../src/infra/realtime/index.js';

const silentLogger = pino({ level: 'silent' });
const PATH = '/realtime';

interface WireMessage {
  type: string;
  data: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

/** Reads `x-debug-user-id` header / `userId` query; rejects when absent. */
class StubAuthenticator implements ConnectionAuthenticator {
  authenticate(h: RealtimeHandshake): Promise<RealtimePrincipal> {
    const header = h.headers['x-debug-user-id'];
    const userId = (Array.isArray(header) ? header[0] : header) ?? h.query['userId'] ?? null;
    if (!userId) return Promise.reject(new RealtimeAuthError());
    return Promise.resolve({ userId, roles: [], isAnonymous: false });
  }
}

const denyAll: ConnectionAuthenticator = {
  authenticate: () => Promise.reject(new RealtimeAuthError()),
};

/** Allows the caller's own user room and any `conversation:allowed-*` room. */
const testAuthorizer: RealtimeAuthorizer = {
  canSubscribe: (p, room) =>
    Promise.resolve(
      (p.userId !== null && room === rooms.user(p.userId)) ||
        room.startsWith('conversation:allowed'),
    ),
};

function collector(ws: WebSocket): {
  waitFor: (type: string, timeoutMs?: number) => Promise<WireMessage>;
} {
  const queue: WireMessage[] = [];
  const waiters: ((m: WireMessage) => void)[] = [];
  ws.on('message', (raw: Buffer) => {
    const msg = JSON.parse(raw.toString('utf8')) as WireMessage;
    const w = waiters.shift();
    if (w) w(msg);
    else queue.push(msg);
  });

  const next = (timeoutMs: number): Promise<WireMessage> =>
    new Promise((resolve, reject) => {
      const queued = queue.shift();
      if (queued) {
        resolve(queued);
        return;
      }
      const waiter = (m: WireMessage): void => {
        clearTimeout(timer);
        resolve(m);
      };
      const timer = setTimeout(() => {
        const i = waiters.indexOf(waiter);
        if (i >= 0) waiters.splice(i, 1);
        reject(new Error('timed out waiting for message'));
      }, timeoutMs);
      waiters.push(waiter);
    });

  return {
    async waitFor(type: string, timeoutMs = 3000): Promise<WireMessage> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`timed out waiting for "${type}"`);
        const msg = await next(remaining);
        if (msg.type === type) return msg;
      }
    },
  };
}

describe('WsRealtimeGateway (integration)', () => {
  let server: Server;
  let gateway: WsRealtimeGateway;
  let url: string;
  const clients: WebSocket[] = [];

  function start(authenticator: ConnectionAuthenticator): Promise<void> {
    server = createServer();
    gateway = new WsRealtimeGateway({
      path: PATH,
      pingIntervalMs: 60_000,
      logger: silentLogger,
      authenticator,
      authorizer: testAuthorizer,
    });
    gateway.attach(server);
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        url = `ws://127.0.0.1:${port}${PATH}`;
        resolve();
      });
    });
  }

  function connect(headers: Record<string, string> = {}): WebSocket {
    const ws = new WebSocket(url, { headers });
    clients.push(ws);
    return ws;
  }

  const open = (ws: WebSocket): Promise<void> =>
    new Promise((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

  beforeEach(() => {
    clients.length = 0;
  });

  afterEach(async () => {
    for (const c of clients) c.terminate();
    await gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects the upgrade with 401 when authentication fails', async () => {
    await start(denyAll);
    const ws = connect({ 'x-debug-user-id': 'u1' });

    const status = await new Promise<number>((resolve, reject) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('open', () => reject(new Error('should not have connected')));
      ws.on('error', () => {
        /* fires alongside unexpected-response */
      });
    });
    expect(status).toBe(401);
    expect(gateway.connectionCount()).toBe(0);
  });

  it('authenticates, sends a welcome frame and auto-joins the user room', async () => {
    await start(new StubAuthenticator());
    const ws = connect({ 'x-debug-user-id': 'u1' });
    const rx = collector(ws);
    await open(ws);

    const welcome = await rx.waitFor('welcome');
    expect(welcome.data.userId).toBe('u1');
    expect(welcome.data.rooms).toEqual([rooms.user('u1')]);
    expect(gateway.connectionCount()).toBe(1);
  });

  it('delivers emitToUser to the matching connection', async () => {
    await start(new StubAuthenticator());
    const ws = connect({ 'x-debug-user-id': 'u1' });
    const rx = collector(ws);
    await open(ws);
    await rx.waitFor('welcome');

    gateway.emitToUser('u1', { type: 'notification.created', data: { id: 'n1' } });
    const msg = await rx.waitFor('notification.created');
    expect(msg.data).toEqual({ id: 'n1' });
    expect(msg.meta).toBeDefined();
  });

  it('honours the authorizer on subscribe and then routes room emits', async () => {
    await start(new StubAuthenticator());
    const ws = connect({ 'x-debug-user-id': 'u1' });
    const rx = collector(ws);
    await open(ws);
    await rx.waitFor('welcome');

    ws.send(JSON.stringify({ type: 'subscribe', data: { room: 'conversation:denied-1' } }));
    const denied = await rx.waitFor('error');
    expect(denied.data.message).toBe('subscription denied');

    ws.send(JSON.stringify({ type: 'subscribe', data: { room: 'conversation:allowed-1' } }));
    const ok = await rx.waitFor('subscribed');
    expect(ok.data.room).toBe('conversation:allowed-1');

    gateway.emitToRoom('conversation:allowed-1', {
      type: 'chat.message.created',
      data: { text: 'hi' },
    });
    const delivered = await rx.waitFor('chat.message.created');
    expect(delivered.data).toEqual({ text: 'hi' });
  });

  it('replies to a client ping control frame with pong', async () => {
    await start(new StubAuthenticator());
    const ws = connect({ 'x-debug-user-id': 'u1' });
    const rx = collector(ws);
    await open(ws);
    await rx.waitFor('welcome');

    ws.send(JSON.stringify({ type: 'ping', data: {} }));
    await expect(rx.waitFor('pong')).resolves.toBeDefined();
  });

  it('drops connections and clears rooms on close()', async () => {
    await start(new StubAuthenticator());
    const ws = connect({ 'x-debug-user-id': 'u1' });
    await open(ws);
    expect(gateway.connectionCount()).toBe(1);

    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
    await gateway.close();
    await closed;
    expect(gateway.connectionCount()).toBe(0);
  });
});

describe('WsRealtimeGateway connection cap', () => {
  let server: Server;
  let gateway: WsRealtimeGateway;
  let url: string;
  const clients: WebSocket[] = [];

  beforeEach(
    () =>
      new Promise<void>((resolve) => {
        server = createServer();
        gateway = new WsRealtimeGateway({
          path: PATH,
          pingIntervalMs: 60_000,
          logger: silentLogger,
          authenticator: new StubAuthenticator(),
          authorizer: testAuthorizer,
          maxConnections: 1,
        });
        gateway.attach(server);
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as AddressInfo;
          url = `ws://127.0.0.1:${port}${PATH}`;
          resolve();
        });
      }),
  );

  afterEach(async () => {
    for (const c of clients) c.terminate();
    clients.length = 0;
    await gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects an upgrade past maxConnections with HTTP 503', async () => {
    const first = new WebSocket(url, { headers: { 'x-debug-user-id': 'u1' } });
    clients.push(first);
    await new Promise<void>((resolve, reject) => {
      first.once('open', () => resolve());
      first.once('error', reject);
    });
    expect(gateway.connectionCount()).toBe(1);

    const second = new WebSocket(url, { headers: { 'x-debug-user-id': 'u2' } });
    clients.push(second);
    const status = await new Promise<number>((resolve, reject) => {
      second.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      second.on('open', () => reject(new Error('should not have connected')));
      second.on('error', () => {
        /* fires alongside unexpected-response */
      });
    });
    expect(status).toBe(503);
    expect(gateway.connectionCount()).toBe(1);
  });
});
