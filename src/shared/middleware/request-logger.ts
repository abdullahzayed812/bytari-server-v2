import { randomUUID } from 'node:crypto';
import { pinoHttp, type Options } from 'pino-http';
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';

/**
 * HTTP request logging + per-request correlation id.
 *
 * Honours an inbound `x-request-id` header when present, otherwise generates a
 * UUID. The id is echoed back on the response and available as `req.id`.
 */
export function requestLogger(logger: Logger): RequestHandler {
  const options: Options = {
    logger,
    genReqId: (req, res) => {
      const header = req.headers['x-request-id'];
      const id = (Array.isArray(header) ? header[0] : header) ?? randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
    customErrorMessage: (req, _res, err) => `${req.method} ${req.url} failed: ${err.message}`,
  };

  return pinoHttp(options);
}
