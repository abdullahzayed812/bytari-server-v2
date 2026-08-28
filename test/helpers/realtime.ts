import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { pino } from 'pino';
import { WebSocket } from 'ws';
import { loadConfig } from '../../src/config/index.js';
import { InMemoryEventBus } from '../../src/shared/events/index.js';
import { createContainer, type Container, type ContainerDeps } from '../../src/container.js';
import { createInfrastructure, type Infrastructure } from '../../src/infra/index.js';
import { createChatRealtime } from '../../src/modules/chat/index.js';
import { createSupportRealtime } from '../../src/modules/consultations/index.js';
import { createContentRealtime } from '../../src/modules/content/index.js';
import { createNotificationRealtime } from '../../src/modules/notifications/index.js';
import { createApp } from '../../src/app.js';
import { getTestDb } from './db.js';

const logger = pino({ level: 'silent' });

export interface RealtimeHarness {
  app: Express;
  container: Container;
  infra: Infrastructure;
  server: Server;
  port: number;
  wsUrl: (token?: string) => string;
  close: () => Promise<void>;
}

/** Stand up a real HTTP server with the WebSocket gateway attached (chat + support realtime wired). */
export async function buildRealtimeHarness(
  overrides: Pick<ContainerDeps, 'aiResponder' | 'objectStorage' | 'pushProvider'> = {},
): Promise<RealtimeHarness> {
  const config = loadConfig();
  const db = getTestDb();
  const eventBus = new InMemoryEventBus(logger);
  const container = createContainer({ db, config, logger, eventBus, ...overrides });

  const chatRealtime = createChatRealtime(container);
  const supportRealtime = createSupportRealtime(container);
  const contentRealtime = createContentRealtime(container);
  const notificationRealtime = createNotificationRealtime();
  supportRealtime.registerAuthorizers(chatRealtime.authorizer);
  contentRealtime.registerAuthorizers(chatRealtime.authorizer);

  const infra = createInfrastructure({
    config,
    logger,
    eventBus,
    realtimeAuthenticator: chatRealtime.authenticator,
    realtimeAuthorizer: chatRealtime.authorizer,
    objectStorage: container.objectStorage,
    pushProvider: container.pushProvider,
    pushNotificationService: container.pushNotificationService,
  });
  chatRealtime.registerBridgeRoutes(infra.realtimeBridge);
  supportRealtime.registerBridgeRoutes(infra.realtimeBridge);
  contentRealtime.registerBridgeRoutes(infra.realtimeBridge);
  notificationRealtime.registerBridgeRoutes(infra.realtimeBridge);

  const app = createApp({ config, db, logger, infra, container });
  const server = createServer(app);
  infra.attach(server);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    app,
    container,
    infra,
    server,
    port,
    wsUrl: (token?: string) =>
      `ws://127.0.0.1:${port}${config.realtime.path}${token ? `?access_token=${token}` : ''}`,
    async close() {
      await infra.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export interface WsEnvelope {
  type: string;
  data: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

/** A tiny promise-based WebSocket client for tests. */
interface Waiter {
  predicate: (e: WsEnvelope) => boolean;
  resolve: (e: WsEnvelope) => void;
}

export class TestWs {
  private readonly inbox: WsEnvelope[] = [];
  private readonly waiters: Waiter[] = [];

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      let parsed: WsEnvelope;
      try {
        parsed = JSON.parse(raw.toString()) as WsEnvelope;
      } catch {
        return;
      }
      const idx = this.waiters.findIndex((w) => w.predicate(parsed));
      const waiter = idx >= 0 ? this.waiters.splice(idx, 1)[0] : undefined;
      if (waiter) waiter.resolve(parsed);
      else this.inbox.push(parsed);
    });
  }

  /** Connect, or reject if the upgrade is refused (e.g. 401). */
  static connect(url: string): Promise<TestWs> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.once('open', () => resolve(new TestWs(ws)));
      ws.once('unexpected-response', (_req, res) => {
        reject(new Error(`unexpected-response ${res.statusCode}`));
      });
      ws.once('error', (err) => reject(err));
    });
  }

  send(type: string, data: Record<string, unknown> = {}): void {
    this.ws.send(JSON.stringify({ type, data }));
  }

  /** Resolve with the next (or already-buffered) message matching `type`. */
  next(type: string, timeoutMs = 1500): Promise<WsEnvelope> {
    const predicate = (e: WsEnvelope): boolean => e.type === type;
    const bufferedIdx = this.inbox.findIndex(predicate);
    const buffered = bufferedIdx >= 0 ? this.inbox.splice(bufferedIdx, 1)[0] : undefined;
    if (buffered) return Promise.resolve(buffered);

    return new Promise<WsEnvelope>((resolve, reject) => {
      const wrapped = (e: WsEnvelope): void => {
        clearTimeout(timer);
        resolve(e);
      };
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.resolve === wrapped);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`timeout waiting for "${type}"`));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve: wrapped });
    });
  }

  close(): void {
    this.ws.close();
  }
}
