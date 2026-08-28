import type { RequestHandler } from 'express';
import { NotFoundError } from '../errors/app-error.js';

/** Terminal middleware for unmatched routes. Must be registered last, before the error handler. */
export function notFoundHandler(): RequestHandler {
  return (req, _res, next) => {
    next(new NotFoundError(`Route not found: ${req.method} ${req.path}`));
  };
}
