import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { sendSuccess } from '../../shared/http/response.js';
import { validate, validatedQuery } from '../../shared/http/validate.js';
import type { Container } from '../../container.js';
import { requireAuth } from '../auth/authenticate.middleware.js';
import { SEARCH_TYPES, type SearchType } from './search.service.js';

/**
 * `GET /search?q=&types=BOOK,CLINIC&limit=5` — the Home header global search.
 * Authenticated; every result type is filtered by the same visibility rules as
 * its own list endpoint (see `SearchService`).
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
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
});
type SearchQuery = { q: string; types?: SearchType[]; limit: number };

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
