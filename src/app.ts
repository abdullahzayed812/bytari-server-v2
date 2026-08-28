import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { AppConfig } from './config/index.js';
import type { Infrastructure } from './infra/index.js';
import { createContainer, type Container } from './container.js';
import { requestLogger } from './shared/middleware/request-logger.js';
import { errorHandler } from './shared/middleware/error-handler.js';
import { notFoundHandler } from './shared/middleware/not-found.js';
import { RateLimitError } from './shared/errors/app-error.js';
import { sendSuccess } from './shared/http/response.js';
import { createApiRouter } from './routes/index.js';
import { mountOpenApi } from './openapi/index.js';

export interface AppDependencies {
  config: AppConfig;
  db: Knex;
  logger: Logger;
  /** Optional so lightweight tests can construct the app without infra. */
  infra?: Infrastructure;
  /**
   * Pre-built service container. When omitted one is created here — pass an
   * explicit container to share the event bus with {@link Infrastructure}.
   */
  container?: Container;
}

function describeInfrastructure(
  config: AppConfig,
  infra?: Infrastructure,
): Record<string, unknown> {
  return {
    realtime: {
      enabled: infra?.realtime.isEnabled() ?? config.realtime.enabled,
      path: config.realtime.path,
      connections: infra?.realtime.connectionCount() ?? 0,
    },
    push: { provider: infra?.push.providerName ?? (config.firebase ? 'firebase' : 'noop') },
    storage: {
      provider: infra?.storage.name ?? (config.storage.r2 ? 'cloudflare-r2' : 'in-memory'),
    },
  };
}

export const API_PREFIX = '/api/v1';

/**
 * Compose the Express application from its middleware, routes and error
 * handling. Pure factory — it does not bind a port (see `server.ts`).
 */
export function createApp({ config, db, logger, infra, container }: AppDependencies): Express {
  const app = express();
  const services = container ?? createContainer({ db, config, logger });

  // Behind a load balancer / reverse proxy in every real deployment.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // --- Observability (first, so every request — including parser failures —
  //     gets a correlation id and a log line) --------------------------------
  app.use(requestLogger(logger));

  // --- Security & parsing -------------------------------------------------
  app.use(helmet());
  app.use(
    cors({
      origin: config.http.corsOrigins.includes('*') ? true : config.http.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: config.http.bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: config.http.bodyLimit }));

  // --- Rate limiting (disabled under test for deterministic specs) -----------
  if (!config.isTest) {
    app.use(
      rateLimit({
        windowMs: config.http.rateLimit.windowMs,
        limit: config.http.rateLimit.max,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: (_req, _res, next) => next(new RateLimitError()),
      }),
    );
  }

  // --- Meta ----------------------------------------------------------------
  app.get('/', (_req, res) => {
    sendSuccess(res, {
      name: 'bytari-backend',
      phase:
        'Phase 16 — Production hardening & release readiness (full security / reliability / observability audit; WebSocket connection cap; DB statement timeout; container HEALTHCHECK + graceful shutdown; operations runbook). No new product endpoints. Phases 1–15 features are unchanged. Phase 9 Appointments and Phase 11 Veterinary Jobs / Doctor Offers remain deferred: neither is in the confirmed product spec.',
      docs: '/docs',
      openapi: '/openapi.json',
      apiBase: API_PREFIX,
      infrastructure: describeInfrastructure(config, infra),
    });
  });

  mountOpenApi(app, '0.14.0');

  // --- API ---------------------------------------------------------------
  const apiRouter = createApiRouter(services);
  app.use(API_PREFIX, apiRouter);
  // Health probes are also exposed unversioned for infra tooling / k8s.
  app.use('/', apiRouter);

  // --- Fallbacks -------------------------------------------------------------
  app.use(notFoundHandler());
  app.use(errorHandler(config));

  return app;
}
