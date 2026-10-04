import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { sendSuccess } from '../../shared/http/response.js';
import { validate, validatedQuery } from '../../shared/http/validate.js';
import type { Container } from '../../container.js';
import { requireAuth } from '../auth/authenticate.middleware.js';
import {
  INTERFACE_SEARCH_TYPES,
  SEARCH_INTERFACES,
  SEARCH_TYPES,
  type SearchInterface,
  type SearchType,
} from './search.service.js';

/**
 * `GET /search?q=&interface=PET_OWNER|VETERINARIAN&types=…&limit=5` — the Home
 * header global search. Authenticated; scoped to ONE application interface
 * (default `PET_OWNER`): only that interface's sections are searched, a type
 * from another interface is rejected (400), and the `VETERINARIAN` interface
 * needs an approved veterinarian (403). Every result type is filtered by the
 * same visibility rules as its own list endpoint (see `SearchService`).
 */
export const searchQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(120),
    interface: z.enum(SEARCH_INTERFACES).optional().default('PET_OWNER'),
    types: z
      .string()
      .optional()
      .transform((v) =>
        v
          ? v
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
      )
      .pipe(z.array(z.enum(SEARCH_TYPES)).max(SEARCH_TYPES.length).optional()),
    limit: z.coerce.number().int().min(1).max(20).optional().default(5),
  })
  .superRefine((v, ctx) => {
    const allowed = INTERFACE_SEARCH_TYPES[v.interface];
    const foreign = (v.types ?? []).filter((t) => !allowed.includes(t));
    if (foreign.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['types'],
        message: `not searchable in the ${v.interface} interface: ${foreign.join(', ')}`,
      });
    }
  });
type SearchQuery = {
  q: string;
  interface: SearchInterface;
  types?: SearchType[];
  limit: number;
};

export function createSearchRouter(c: Container): Router {
  const r = Router();
  r.use(c.authenticate);
  r.get(
    '/',
    validate({ query: searchQuerySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validatedQuery<SearchQuery>(req);
      sendSuccess(res, await c.searchService.search(requireAuth(req), q));
    }),
  );
  return r;
}
