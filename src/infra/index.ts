import type { Server as HttpServer } from 'node:http';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/index.js';
import type { EventBus } from '../shared/events/index.js';
import {
  createRealtimeGateway,
  RealtimeEventBridge,
  type ConnectionAuthenticator,
  type RealtimeAuthorizer,
  type RealtimeGateway,
} from './realtime/index.js';
import {
  createPushProvider,
  InMemoryDeviceTokenRepository,
  PushEventBridge,
  PushNotificationService,
  type DeviceTokenRepository,
  type PushNotificationProvider,
} from './push/index.js';
import { createObjectStorage, type ObjectStorage } from './storage/index.js';

export * as realtime from './realtime/index.js';
export * as push from './push/index.js';
export * as storage from './storage/index.js';

export interface InfrastructureDeps {
  config: AppConfig;
  logger: Logger;
  eventBus: EventBus;
  /** Overrides — Phase 2+ supplies real implementations. */
  realtimeAuthenticator?: ConnectionAuthenticator;
  realtimeAuthorizer?: RealtimeAuthorizer;
  deviceTokenRepository?: DeviceTokenRepository;
  /** Share one storage instance with the service container (Phase 14). */
  objectStorage?: ObjectStorage;
  /** Share the container's push provider / service (Phase 15) so token pruning is unified. */
  pushProvider?: PushNotificationProvider;
  pushNotificationService?: PushNotificationService;
}

/**
 * Composed infrastructure surface handed to the app. Business modules receive
 * the narrow pieces they need (publisher, push service, storage, event bus) —
 * never the transports underneath.
 */
export interface Infrastructure {
  realtime: RealtimeGateway;
  realtimeBridge: RealtimeEventBridge;
  push: PushNotificationService;
  pushBridge: PushEventBridge;
  storage: ObjectStorage;
  /** Called once the HTTP server exists, to bind the WebSocket upgrade handler. */
  attach(server: HttpServer): void;
  /** Graceful teardown for process shutdown. */
  shutdown(): Promise<void>;
}

export function createInfrastructure(deps: InfrastructureDeps): Infrastructure {
  const { config, logger, eventBus } = deps;

  const realtime = createRealtimeGateway({
    config,
    logger,
    authenticator: deps.realtimeAuthenticator,
    authorizer: deps.realtimeAuthorizer,
  });
  const realtimeBridge = new RealtimeEventBridge(eventBus, realtime, logger);

  const pushProvider = deps.pushProvider ?? createPushProvider(config, logger);
  const deviceTokens = deps.deviceTokenRepository ?? new InMemoryDeviceTokenRepository();
  const push =
    deps.pushNotificationService ?? new PushNotificationService(pushProvider, deviceTokens, logger);
  const pushBridge = new PushEventBridge(eventBus, push, logger);

  const storage = deps.objectStorage ?? createObjectStorage(config, logger);

  realtimeBridge.start();
  pushBridge.start();

  return {
    realtime,
    realtimeBridge,
    push,
    pushBridge,
    storage,
    attach(server: HttpServer): void {
      realtime.attach(server);
    },
    async shutdown(): Promise<void> {
      realtimeBridge.stop();
      pushBridge.stop();
      await realtime.close();
      await pushProvider.shutdown();
    },
  };
}
