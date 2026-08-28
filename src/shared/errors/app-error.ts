import { StatusCodes } from 'http-status-codes';
import { ErrorCode, type ErrorCodeValue } from './error-codes.js';

/** A single, structured detail entry (e.g. one field validation failure). */
export interface ErrorDetail {
  path?: string;
  message: string;
  rule?: string;
}

export interface AppErrorOptions {
  /** Machine-readable code from {@link ErrorCode}. */
  code?: ErrorCodeValue;
  /** Structured, client-safe details (field errors, etc.). */
  details?: ErrorDetail[];
  /** Underlying cause, kept for logging only — never serialised to clients. */
  cause?: unknown;
  /**
   * Operational errors are expected failures (bad input, missing resource).
   * Non-operational errors indicate a bug and are logged at `error` level.
   */
  isOperational?: boolean;
}

/**
 * Base class for every error the API deliberately produces.
 * The global error handler knows how to serialise these consistently.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCodeValue;
  readonly details?: ErrorDetail[];
  readonly isOperational: boolean;

  constructor(message: string, statusCode: number, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = options.code ?? ErrorCode.INTERNAL_ERROR;
    this.details = options.details;
    this.isOperational = options.isOperational ?? true;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', options: AppErrorOptions = {}) {
    super(message, StatusCodes.BAD_REQUEST, { code: ErrorCode.BAD_REQUEST, ...options });
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details: ErrorDetail[] = []) {
    super(message, StatusCodes.UNPROCESSABLE_ENTITY, {
      code: ErrorCode.VALIDATION_ERROR,
      details,
    });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', options: AppErrorOptions = {}) {
    super(message, StatusCodes.UNAUTHORIZED, { code: ErrorCode.UNAUTHORIZED, ...options });
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = 'You do not have permission to perform this action',
    options: AppErrorOptions = {},
  ) {
    super(message, StatusCodes.FORBIDDEN, { code: ErrorCode.FORBIDDEN, ...options });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', options: AppErrorOptions = {}) {
    super(message, StatusCodes.NOT_FOUND, { code: ErrorCode.NOT_FOUND, ...options });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', options: AppErrorOptions = {}) {
    super(message, StatusCodes.CONFLICT, { code: ErrorCode.CONFLICT, ...options });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests', options: AppErrorOptions = {}) {
    super(message, StatusCodes.TOO_MANY_REQUESTS, { code: ErrorCode.RATE_LIMITED, ...options });
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error', options: AppErrorOptions = {}) {
    super(message, StatusCodes.INTERNAL_SERVER_ERROR, {
      code: ErrorCode.INTERNAL_ERROR,
      isOperational: false,
      ...options,
    });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', options: AppErrorOptions = {}) {
    super(message, StatusCodes.SERVICE_UNAVAILABLE, {
      code: ErrorCode.SERVICE_UNAVAILABLE,
      ...options,
    });
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
