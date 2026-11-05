import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { StatusCodes } from 'http-status-codes';
import type { Container } from '../../../container.js';
import { ForbiddenError } from '../../../shared/errors/app-error.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { pageMeta, paginationQuerySchema } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import {
  validate,
  validatedBody,
  validatedParams,
  validatedQuery,
} from '../../../shared/http/validate.js';
import { dateOnlySchema } from '../../../shared/validation/date-only.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { SUPERVISION_TYPES } from '../domain/poultry-supervision.types.js';

const governorate = z.string().trim().min(1).max(120).optional();

export const adminPoultrySupervisionQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(160).optional(),
  governorate,
});
type ListQuery = z.infer<typeof adminPoultrySupervisionQuerySchema>;

const veterinariansQuerySchema = adminPoultrySupervisionQuerySchema.extend({
  link: z.enum(['linked', 'unlinked']).optional(),
});
type VetsQuery = z.infer<typeof veterinariansQuerySchema>;

const summaryQuerySchema = z.object({ governorate });

const linkDetails = {
  veterinarianUserId: z.string().uuid(),
  supervisionType: z.enum(SUPERVISION_TYPES),
  startDate: dateOnlySchema(),
  notes: z.string().trim().max(1000).optional(),
};
const createLinkBodySchema = z
  .object({ organizationId: z.string().uuid(), ...linkDetails })
  .strict();
type CreateLinkBody = z.infer<typeof createLinkBodySchema>;
const replaceLinkBodySchema = z.object(linkDetails).strict();
type ReplaceLinkBody = z.infer<typeof replaceLinkBodySchema>;
const membershipParamSchema = z.object({ membershipId: z.string().uuid() });

/**
 * `/admin/poultry-supervisors/*` — Admin "Poultry Supervisors Management"
 * (إدارة ارتباط الأطباء بالحقول):
 *  - GET  `/summary?governorate=`          the four counters
 *  - GET  `/linked-farms`                  farms with their supervising vet(s)
 *  - GET  `/unlinked-farms`                poultry farms with no vet
 *  - GET  `/veterinarians?link=`           approved vets (+ current farm links)
 *  - POST `/links`                         link a vet to a farm (farm must have none)
 *  - PUT  `/links/:membershipId/replace`   change the farm's supervising vet
 *  - DELETE `/links/:membershipId`         unlink
 * Lists take `page`, `pageSize`, `search`, `governorate`.
 * ADMIN-ONLY: checked on the ADMIN role itself (no permission key, so no
 * supervisor domain or MODERATOR read can reach it). Mounted on its own path
 * — never path-less (see the `/admin` mount trap).
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
  const actor = (
    req: Request,
  ): { actorUserId: string; context: ReturnType<typeof auditContextFromRequest> } => ({
    actorUserId: requireAuth(req).userId,
    context: auditContextFromRequest(req),
  });

  r.get(
    '/summary',
    validate({ query: summaryQuerySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const q = validatedQuery<z.infer<typeof summaryQuerySchema>>(req);
      sendSuccess(res, await service.summary({ governorate: q.governorate }));
    }),
  );

  const paged =
    <Q extends ListQuery>(fn: (q: Q) => Promise<{ items: unknown[]; total: number }>) =>
    async (req: Request, res: Response): Promise<void> => {
      const q = validatedQuery<Q>(req);
      const { items, total } = await fn(q);
      sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
    };

  r.get(
    '/linked-farms',
    validate({ query: adminPoultrySupervisionQuerySchema }),
    asyncHandler(paged<ListQuery>((q) => service.listLinkedFarms(q))),
  );
  r.get(
    '/unlinked-farms',
    validate({ query: adminPoultrySupervisionQuerySchema }),
    asyncHandler(paged<ListQuery>((q) => service.listUnlinkedFarms(q))),
  );
  r.get(
    '/veterinarians',
    validate({ query: veterinariansQuerySchema }),
    asyncHandler(paged<VetsQuery>((q) => service.listVeterinarians(q))),
  );

  r.post(
    '/links',
    validate({ body: createLinkBodySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const body = validatedBody<CreateLinkBody>(req);
      sendSuccess(res, await service.link(body, actor(req)), StatusCodes.CREATED);
    }),
  );
  r.put(
    '/links/:membershipId/replace',
    validate({ params: membershipParamSchema, body: replaceLinkBodySchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { membershipId } = validatedParams<{ membershipId: string }>(req);
      const body = validatedBody<ReplaceLinkBody>(req);
      sendSuccess(res, await service.replace(membershipId, body, actor(req)));
    }),
  );
  r.delete(
    '/links/:membershipId',
    validate({ params: membershipParamSchema }),
    asyncHandler(async (req: Request, res: Response) => {
      const { membershipId } = validatedParams<{ membershipId: string }>(req);
      await service.unlink(membershipId, actor(req));
      sendSuccess(res, { success: true });
    }),
  );

  return r;
}
