import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AppConfig } from '../../config/index.js';
import { RateLimitError } from '../errors/app-error.js';

/**
 * Generous per-authenticated-user limiter for endpoints that need SOME abuse
 * protection (presigned-upload issuance, application submission) but are not
 * the anonymous auth endpoints `authRateLimiter` (per-IP) protects. Keyed by
 * `req.auth.userId` — this middleware must run AFTER `authenticate`. Disabled
 * under `NODE_ENV=test` for deterministic specs, matching `authRateLimiter`.
 */
export function userRateLimiter(
  config: AppConfig,
  opts: { windowMs: number; max: number },
): RequestHandler {
  if (config.isTest) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ?? req.ip ?? 'anonymous',
    handler: (_req, _res, next) => next(new RateLimitError('Too many requests')),
  });
}
