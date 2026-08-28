import type { Response } from 'express';
import type { ErrorDetail } from '../errors/app-error.js';
import type { ErrorCodeValue } from '../errors/error-codes.js';

/**
 * Canonical response envelopes. Every endpoint returns one of these shapes so
 * clients can rely on a single parsing strategy.
 */

export interface SuccessEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  error: {
    code: ErrorCodeValue;
    message: string;
    details?: ErrorDetail[];
    requestId?: string;
  };
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  status = 200,
  meta?: Record<string, unknown>,
): void {
  const body: SuccessEnvelope<T> = meta ? { data, meta } : { data };
  res.status(status).json(body);
}

export function sendError(
  res: Response,
  status: number,
  code: ErrorCodeValue,
  message: string,
  details?: ErrorDetail[],
  requestId?: string,
): void {
  const body: ErrorEnvelope = {
    error: {
      code,
      message,
      ...(details && details.length ? { details } : {}),
      ...(requestId ? { requestId } : {}),
    },
  };
  res.status(status).json(body);
}
