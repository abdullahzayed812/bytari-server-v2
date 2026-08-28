import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  ValidationError,
  isAppError,
} from '../../src/shared/errors/app-error.js';
import { ErrorCode } from '../../src/shared/errors/error-codes.js';

describe('AppError hierarchy', () => {
  it('sets status, code and operational flag for known errors', () => {
    const notFound = new NotFoundError('nope');
    expect(notFound.statusCode).toBe(404);
    expect(notFound.code).toBe(ErrorCode.NOT_FOUND);
    expect(notFound.isOperational).toBe(true);
    expect(notFound.name).toBe('NotFoundError');
    expect(isAppError(notFound)).toBe(true);
  });

  it('marks InternalError as non-operational and keeps the cause for logging', () => {
    const cause = new Error('boom');
    const err = new InternalError('failed', { cause });
    expect(err.statusCode).toBe(500);
    expect(err.isOperational).toBe(false);
    expect(err.cause).toBe(cause);
  });

  it('carries structured details on ValidationError', () => {
    const err = new ValidationError('bad', [
      { path: 'body.email', message: 'invalid', rule: 'email' },
    ]);
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(err.details).toHaveLength(1);
  });

  it('supports ad-hoc AppError instances', () => {
    const err = new AppError('teapot', 418, { code: ErrorCode.BAD_REQUEST });
    expect(err.statusCode).toBe(418);
    expect(isAppError(err)).toBe(true);
  });

  it('distinguishes non-AppError values', () => {
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError('string')).toBe(false);
    expect(new ForbiddenError().statusCode).toBe(403);
    expect(new ConflictError().statusCode).toBe(409);
  });
});
