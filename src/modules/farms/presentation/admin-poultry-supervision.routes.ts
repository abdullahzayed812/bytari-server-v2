import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { StatusCodes } from 'http-status-codes';
import type { Container } from '../../../container.js';
import { ForbiddenError } from '../../../shared/errors/app-error.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { pageMeta, paginationQuerySchema } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validate, validatedQuery } from '../../../shared/http/validate.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';

export const adminPoultrySupervisionQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(160).optional(),
});
type Query = z.infer<typeof adminPoultrySupervisionQuerySchema>;

/**
 * `/admin/poultry-supervisors/*` — Admin "Poultry Supervisors Management"
 * (إدارة مشرفي الدواجن): linked vets ↔ farms, unlinked poultry farms,
 * unlinked veterinarians. ADMIN-ONLY: checked on the ADMIN role itself (no
 * permission key, so no supervisor domain or MODERATOR read can reach it).
 * Mounted on its own path — never path-less (see the `/admin` mount trap).
 */
export function createAdminPoultrySupervisionRouter(c: Container): Router {
  const service = c.poultrySupervisionService;
  const r = Router();
  r.use(c.authenticate);
  r.use(
    asyncHandler((req, _res, next) => {
      if (!c.authorizationService.isAdmin(requireAuth(req))) {
        throw new ForbiddenError('Only an administrator can manage poultry supervisors');
      }
      next();
    }),
  );

  r.get(
    '/summary',
    asyncHandler(async (_req: Request, res: Response) => {
      sendSuccess(res, await service.summary());
    }),
  );

  const list = (
    fn: (q: Query) => Promise<{ items: unknown[]; total: number }>,
  ): ((req: Request, res: Response) => Promise<void>) => {
    return async (req, res) => {
      const q = validatedQuery<Query>(req);
      const { items, total } = await fn(q);
      sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
    };
  };

  r.get(
    '/linked',
    validate({ query: adminPoultrySupervisionQuerySchema }),
    asyncHandler(list((q) => service.listLinked(q))),
  );
  r.get(
    '/unlinked-farms',
    validate({ query: adminPoultrySupervisionQuerySchema }),
    asyncHandler(list((q) => service.listUnlinkedFarms(q))),
  );
  r.get(
    '/unlinked-veterinarians',
    validate({ query: adminPoultrySupervisionQuerySchema }),
    asyncHandler(list((q) => service.listUnlinkedVeterinarians(q))),
  );

  return r;
}
