import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { validate } from '../../src/shared/http/validate.js';
import { AppError } from '../../src/shared/errors/app-error.js';

function run(
  middleware: ReturnType<typeof validate>,
  req: Partial<Request>,
): { req: Partial<Request>; error: unknown } {
  let error: unknown;
  const next = vi.fn((err?: unknown) => {
    error = err;
  });
  middleware(req as Request, {} as Response, next as unknown as (err?: unknown) => void);
  return { req, error };
}

describe('validate() middleware', () => {
  const schema = validate({
    body: z.object({ name: z.string().min(2) }),
    query: z.object({ page: z.coerce.number().int().positive().default(1) }),
  });

  it('attaches coerced, parsed data to req.validated on success', () => {
    const { req, error } = run(schema, { body: { name: 'Rex' }, query: { page: '3' }, params: {} });
    expect(error).toBeUndefined();
    expect(req.validated?.body).toEqual({ name: 'Rex' });
    expect(req.validated?.query).toEqual({ page: 3 });
  });

  it('applies schema defaults', () => {
    const { req } = run(schema, { body: { name: 'Rex' }, query: {}, params: {} });
    expect(req.validated?.query).toEqual({ page: 1 });
  });

  it('forwards a 422 ValidationError with aggregated details', () => {
    const { error } = run(schema, { body: { name: 'x' }, query: { page: '-1' }, params: {} });
    expect(error).toBeInstanceOf(AppError);
    const appErr = error as AppError;
    expect(appErr.statusCode).toBe(422);
    expect(appErr.details?.length).toBeGreaterThanOrEqual(2);
    expect(appErr.details?.map((d) => d.path)).toContain('body.name');
    expect(appErr.details?.map((d) => d.path)).toContain('query.page');
  });

  it('does not mutate req.query in place (Express 5 getter safety)', () => {
    const query = Object.freeze({ page: '2' });
    const { error } = run(schema, { body: { name: 'Rex' }, query: query as never, params: {} });
    expect(error).toBeUndefined();
  });
});
