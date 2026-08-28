import { createServer, type Server } from 'node:http';
import { loadConfig } from './config/index.js';
import { createLogger } from './shared/logger/index.js';
import { createKnex } from './database/knex.js';
import { InMemoryEventBus } from './shared/events/index.js';
import { createInfrastructure } from './infra/index.js';
import { createContainer } from './container.js';
import { createChatRealtime } from './modules/chat/index.js';
import { createSupportRealtime } from './modules/consultations/index.js';
import { createContentRealtime } from './modules/content/index.js';
import { createNotificationRealtime } from './modules/notifications/index.js';
import { createApp } from './app.js';

/**
 * Process entry point: wire real dependencies, start listening, and shut down
 * cleanly on signals.
 */
function bootstrap(): void {
  const config = loadConfig();
  const logger = createLogger(config);
  const db = createKnex(config);
  const eventBus = new InMemoryEventBus(logger);
  const container = createContainer({ db, config, logger, eventBus });

  // Chat (Phase 12) supplies the real WebSocket authenticator + the process-wide
  // composite subscription authorizer. Phase 13 registers its own room kinds
  // (`consultation:`, `inquiry:`) on the SAME composite before it is handed to
  // the infrastructure.
  const chatRealtime = createChatRealtime(container);
  const supportRealtime = createSupportRealtime(container);
  const contentRealtime = createContentRealtime(container);
  supportRealtime.registerAuthorizers(chatRealtime.authorizer);
  contentRealtime.registerAuthorizers(chatRealtime.authorizer);

  const notificationRealtime = createNotificationRealtime();

  const infra = createInfrastructure({
    config,
    logger,
    eventBus,
    realtimeAuthenticator: chatRealtime.authenticator,
    realtimeAuthorizer: chatRealtime.authorizer,
    objectStorage: container.objectStorage,
    pushProvider: container.pushProvider,
    pushNotificationService: container.pushNotificationService,
    deviceTokenRepository: container.deviceTokenRepository,
  });
  chatRealtime.registerBridgeRoutes(infra.realtimeBridge);
  supportRealtime.registerBridgeRoutes(infra.realtimeBridge);
  contentRealtime.registerBridgeRoutes(infra.realtimeBridge);
  notificationRealtime.registerBridgeRoutes(infra.realtimeBridge);

  const app = createApp({ config, db, logger, infra, container });
  const server: Server = createServer(app);

  // Share the HTTP port with the WebSocket gateway.
  infra.attach(server);

  server.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        env: config.env,
        docs: `http://localhost:${config.port}/docs`,
        realtime: infra.realtime.isEnabled() ? config.realtime.path : 'disabled',
        push: infra.push.providerName,
        storage: infra.storage.name,
      },
      'Bytari backend started',
    );
  });

  server.on('error', (err) => {
    logger.fatal({ err }, 'HTTP server error');
    process.exitCode = 1;
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');

    server.close((closeErr) => {
      if (closeErr) logger.error({ err: closeErr }, 'Error closing HTTP server');
      void (async (): Promise<void> => {
        try {
          await infra.shutdown();
        } catch (infraErr) {
          logger.error({ err: infraErr }, 'Error shutting down infrastructure');
        }
        try {
          await db.destroy();
          logger.info('Shutdown complete');
          process.exit(closeErr ? 1 : 0);
        } catch (destroyErr) {
          logger.error({ err: destroyErr }, 'Error closing database pool');
          process.exit(1);
        }
      })();
    });

    // Hard-exit safety net if graceful close hangs.
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => shutdown(signal));
  }

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — exiting');
    process.exit(1);
  });
}

try {
  bootstrap();
} catch (err: unknown) {
  // Logger may not exist yet if config failed to load.
  // eslint-disable-next-line no-console
  console.error('Fatal: failed to start server\n', err instanceof Error ? err.stack : err);
  process.exit(1);
}
