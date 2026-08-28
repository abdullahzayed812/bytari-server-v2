import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AppConfig } from '../../config/index.js';
import { RateLimitError } from '../../shared/errors/app-error.js';

/**
 * Stricter per-IP limiter for unauthenticated auth endpoints (login / register /
 * refresh). Disabled under `NODE_ENV=test` for deterministic specs.
 */
export function authRateLimiter(config: AppConfig): RequestHandler {
  if (config.isTest) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: config.auth.rateLimit.windowMs,
    limit: config.auth.rateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new RateLimitError('Too many authentication attempts')),
  });
}
