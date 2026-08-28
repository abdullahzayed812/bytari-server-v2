import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wrap an async route handler so rejected promises are forwarded to Express's
 * error pipeline instead of becoming unhandled rejections.
 *
 * Express 5 already forwards rejected promises from handlers, but wrapping keeps
 * the behaviour explicit and portable, and preserves handler typing.
 */
export function asyncHandler<Req extends Request = Request, Res extends Response = Response>(
  fn: (req: Req, res: Res, next: NextFunction) => unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as Req, res as Res, next)).catch(next);
  };
}
