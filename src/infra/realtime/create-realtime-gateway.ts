import type { Logger } from 'pino';
import type { AppConfig } from '../../config/index.js';
import {
  AnonymousConnectionAuthenticator,
  DenyAllConnectionAuthenticator,
} from './authenticator.js';
import { SelfRoomAuthorizer } from './authorizer.js';
import { DisabledRealtimeGateway } from './disabled-realtime-gateway.js';
import { WsRealtimeGateway } from './ws-realtime-gateway.js';
import type { ConnectionAuthenticator, RealtimeAuthorizer, RealtimeGateway } from './types.js';

export interface RealtimeGatewayDeps {
  config: AppConfig;
  logger: Logger;
  /** Phase 2 injects a JWT authenticator. Defaults to deny-all (or anonymous in dev). */
  authenticator?: ConnectionAuthenticator;
  /** Modules extend this to authorize their room namespaces. Defaults to self-room only. */
  authorizer?: RealtimeAuthorizer;
}

/**
 * Build the process-wide {@link RealtimeGateway} from configuration.
 * Returns a no-op gateway when real-time is disabled.
 */
export function createRealtimeGateway(deps: RealtimeGatewayDeps): RealtimeGateway {
  const { config, logger } = deps;

  if (!config.realtime.enabled) {
    logger.info('realtime gateway disabled by configuration');
    return new DisabledRealtimeGateway();
  }

  const authenticator =
    deps.authenticator ??
    (config.realtime.allowAnonymous
      ? new AnonymousConnectionAuthenticator(logger)
      : new DenyAllConnectionAuthenticator(logger));

  const authorizer = deps.authorizer ?? new SelfRoomAuthorizer();

  return new WsRealtimeGateway({
    path: config.realtime.path,
    pingIntervalMs: config.realtime.pingIntervalMs,
    logger,
    authenticator,
    authorizer,
    maxConnections: config.realtime.maxConnections,
  });
}
