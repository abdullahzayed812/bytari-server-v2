import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z, ZodError } from 'zod';
import { ValidationError, type ErrorDetail } from '../errors/app-error.js';

export interface ValidationSchemas {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
}

type Inferred<T> = T extends z.ZodTypeAny ? z.infer<T> : unknown;

export interface ValidatedData<S extends ValidationSchemas> {
  body: Inferred<S['body']>;
  query: Inferred<S['query']>;
  params: Inferred<S['params']>;
}

function toDetails(error: ZodError, prefix: string): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].filter(Boolean).join('.'),
    message: issue.message,
    rule: issue.code,
  }));
}

/**
 * Build a middleware that validates and coerces the request `body`, `query`
 * and/or `params` against Zod schemas.
 *
 * Parsed output is attached to `req.validated` — Express 5 exposes `req.query`
 * as a read-only getter, so we never mutate the request in place.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const details: ErrorDetail[] = [];
    const validated: Record<'body' | 'query' | 'params', unknown> = {
      body: req.body,
      query: req.query,
      params: req.params,
    };

    for (const key of ['body', 'query', 'params'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (result.success) {
        validated[key] = result.data;
      } else {
        details.push(...toDetails(result.error, key));
      }
    }

    if (details.length > 0) {
      next(new ValidationError('Request validation failed', details));
      return;
    }

    req.validated = validated;
    next();
  };
}

/** Typed accessors for `validate()` output. The middleware guarantees presence. */
export function validatedBody<T>(req: Request): T {
  return (req.validated?.body ?? {}) as T;
}

export function validatedQuery<T>(req: Request): T {
  return (req.validated?.query ?? {}) as T;
}

export function validatedParams<T>(req: Request): T {
  return (req.validated?.params ?? {}) as T;
}
