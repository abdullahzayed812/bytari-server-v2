import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, InternalError, ValidationError, isAppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import { sendError } from '../http/response.js';
import type { AppConfig } from '../../config/index.js';

/**
 * `body-parser` failure `type` values (from `express.json()` /
 * `express.urlencoded()`). Every one is a client-side fault, never an internal
 * bug: malformed body (400), `BODY_LIMIT` overflow (413), unsupported charset /
 * encoding (415), aborted upload (400), too many parameters (413).
 */
const PARSER_ERROR_TYPES = new Set([
  'entity.parse.failed',
  'entity.verify.failed',
  'entity.too.large',
  'request.aborted',
  'request.size.invalid',
  'stream.encoding.set',
  'stream.not.readable',
  'parameters.too.many',
  'charset.unsupported',
  'encoding.unsupported',
]);

function normalizeParserError(err: unknown): AppError | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as {
    type?: string;
    status?: number;
    statusCode?: number;
    message?: string;
  };
  if (typeof e.type !== 'string' || !PARSER_ERROR_TYPES.has(e.type)) return null;

  const status = e.statusCode ?? e.status ?? 400;
  if (status === 413) {
    return new AppError('Request body is too large', 413, { code: ErrorCode.PAYLOAD_TOO_LARGE });
  }
  if (status === 415) {
    return new AppError('Unsupported request content type or encoding', 415, {
      code: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
    });
  }
  const message =
    e.type === 'entity.parse.failed' ? 'Malformed JSON in request body' : 'Invalid request body';
  return new AppError(message, 400, { code: ErrorCode.BAD_REQUEST });
}

function normalize(err: unknown): AppError {
  if (isAppError(err)) return err;

  if (err instanceof ZodError) {
    return new ValidationError(
      'Request validation failed',
      err.issues.map((i) => ({
        path: i.path.map(String).join('.'),
        message: i.message,
        rule: i.code,
      })),
    );
  }

  const parserError = normalizeParserError(err);
  if (parserError) return parserError;

  // Fallback for a bare JSON SyntaxError without the http-errors envelope.
  if (err instanceof SyntaxError && 'body' in err) {
    return new AppError('Malformed JSON in request body', 400, { code: ErrorCode.BAD_REQUEST });
  }

  const wrapped = new InternalError('Internal server error', { cause: err });
  return wrapped;
}

/**
 * Global error handler. Registered last. Guarantees every failure leaves the
 * app as a consistent {@link sendError} envelope and is logged appropriately.
 */
export function errorHandler(config: AppConfig): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    const appErr = normalize(err);
    const requestId = typeof req.id === 'string' ? req.id : undefined;

    const logPayload = {
      err: appErr.cause ?? appErr,
      statusCode: appErr.statusCode,
      code: appErr.code,
    };
    if (!appErr.isOperational || appErr.statusCode >= 500) {
      req.log?.error(logPayload, appErr.message);
    } else {
      req.log?.warn(logPayload, appErr.message);
    }

    const message =
      !appErr.isOperational && config.isProduction ? 'Internal server error' : appErr.message;

    sendError(res, appErr.statusCode, appErr.code, message, appErr.details, requestId);
  };
}
