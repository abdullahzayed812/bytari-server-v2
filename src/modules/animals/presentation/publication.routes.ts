import type { RequestHandler } from 'express';
import { Router } from 'express';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate, validatedParams } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { AdminPublicationController } from './admin-publication.controller.js';
import { PublicationController } from './publication.controller.js';
import { animalIdParamSchema, createAnimalMiddleware, requireAnimal } from './animal.middleware.js';
import {
  animalPublicationParamSchema,
  createInteractionBodySchema,
  createPublicationBodySchema,
  listAnimalPublicationsQuerySchema,
  listMinePublicationsQuerySchema,
  moderationPublicationsQuerySchema,
  publicPublicationsQuerySchema,
  publicationIdParamSchema,
  rejectPublicationBodySchema,
} from './publication.schemas.js';

/**
 * `/animals/:animalId/publications*` — owner-facing create + read.
 * Mounted at `/animals` after the Phase 4 animal router; the two-segment
 * `.../publications` paths never collide with Phase 4's `/:animalId`.
 */
export function createAnimalPublicationRouter(c: Container): Router {
  const ctrl = new PublicationController(
    c.animalPublicationService,
    c.publicationInteractionService,
  );
  const { withAnimal } = createAnimalMiddleware({
    animals: c.animalService,
    authz: c.authorizationService,
  });

  /** Create is owner-only — no ADMIN bypass (the publisher must be the owner). 404 hides non-owned animals. */
  const ownerOnly: RequestHandler = asyncHandler((req, _res, next) => {
    if (requireAnimal(req).currentOwnerUserId !== requireAuth(req).userId) {
      throw new NotFoundError('Animal not found');
    }
    next();
  });

  /** Read: the current owner, an ADMIN, or a holder of `animal.read` (ANIMAL supervisor). */
  const ownerOrModerator: RequestHandler = asyncHandler(async (req, _res, next) => {
    const principal = requireAuth(req);
    const animal = requireAnimal(req);
    if (
      animal.currentOwnerUserId === principal.userId ||
      c.authorizationService.isAdmin(principal) ||
      (await c.authorizationService.can(principal, 'animal.read'))
    ) {
      next();
      return;
    }
    throw new NotFoundError('Animal not found');
  });

  const r = Router();
  r.use(c.authenticate);

  r.post(
    '/:animalId/publications',
    validate({ params: animalIdParamSchema, body: createPublicationBodySchema }),
    withAnimal,
    ownerOnly,
    asyncHandler(ctrl.create),
  );
  r.get(
    '/:animalId/publications',
    validate({ params: animalIdParamSchema, query: listAnimalPublicationsQuerySchema }),
    withAnimal,
    ownerOrModerator,
    asyncHandler(ctrl.listForAnimal),
  );
  r.get(
    '/:animalId/publications/:publicationId',
    validate({ params: animalPublicationParamSchema }),
    withAnimal,
    ownerOrModerator,
    asyncHandler(ctrl.getForAnimal),
  );

  return r;
}

/**
 * `/animal-publications*` — authenticated browse + "my listings" + delete.
 * The `/` browse and `/:publicationId` detail are APPROVED-only with no owner
 * PII; `/mine` returns the CALLER's own listings of every status (owner id from
 * the session, never the body); `DELETE /:publicationId` is the creator, an
 * ADMIN, or an ACTIVE ANIMAL system-supervisor.
 */
export function createPublicPublicationRouter(c: Container): Router {
  const ctrl = new PublicationController(
    c.animalPublicationService,
    c.publicationInteractionService,
  );

  /**
   * MUST run after `authenticate`. Resolves `:publicationId` and allows the
   * request through only for the listing's creator, an ADMIN, or an ACTIVE
   * ANIMAL system-supervisor. A non-owned publication is hidden with `404`
   * (the same resource-hiding rule the owner-create route uses).
   */
  const ownerOrModerator: RequestHandler = asyncHandler(async (req, _res, next) => {
    const principal = requireAuth(req);
    const { publicationId } = validatedParams<{ publicationId: string }>(req);
    const ctx = await c.animalPublicationService.loadOwnershipContext(publicationId);
    if (!ctx) throw new NotFoundError('Publication not found');
    if (ctx.createdByUserId === principal.userId) return next();
    if (await c.authorizationService.isSystemSupervisorFor(principal, 'ANIMAL')) return next();
    throw new NotFoundError('Publication not found');
  });

  const r = Router();
  r.use(c.authenticate);

  // `/mine` BEFORE `/:publicationId` — same ordering rule as `/users/me`.
  r.get('/mine', validate({ query: listMinePublicationsQuerySchema }), asyncHandler(ctrl.listMine));

  r.get('/', validate({ query: publicPublicationsQuerySchema }), asyncHandler(ctrl.listPublic));
  r.get(
    '/:publicationId',
    validate({ params: publicationIdParamSchema }),
    asyncHandler(ctrl.getPublic),
  );
  r.delete(
    '/:publicationId',
    validate({ params: publicationIdParamSchema }),
    ownerOrModerator,
    asyncHandler(ctrl.remove),
  );
  // "طلب التبني" / "طلب تزاوج" / "ابلاغ عن مشاهدة" — any authenticated user
  // except the listing's own owner (enforced in the service).
  r.post(
    '/:publicationId/interactions',
    validate({ params: publicationIdParamSchema, body: createInteractionBodySchema }),
    asyncHandler(ctrl.createInteraction),
  );

  return r;
}

/**
 * `/admin/animal-publications*` — moderation. `animal.read` to view the queue,
 * `animal.approve` / `animal.reject` to act. All three are held by ADMIN
 * (override) or an ACTIVE ANIMAL system-supervisor domain (docs 03 §3.10).
 */
export function createAdminAnimalPublicationRouter(c: Container): Router {
  const ctrl = new AdminPublicationController(c.animalPublicationService);
  const { authorize } = c.authorization;
  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/',
    authorize('animal.read'),
    validate({ query: moderationPublicationsQuerySchema }),
    asyncHandler(ctrl.list),
  );
  r.get(
    '/:publicationId',
    authorize('animal.read'),
    validate({ params: publicationIdParamSchema }),
    asyncHandler(ctrl.getOne),
  );
  r.post(
    '/:publicationId/approve',
    authorize('animal.approve'),
    validate({ params: publicationIdParamSchema }),
    asyncHandler(ctrl.approve),
  );
  r.post(
    '/:publicationId/reject',
    authorize('animal.reject'),
    validate({ params: publicationIdParamSchema, body: rejectPublicationBodySchema }),
    asyncHandler(ctrl.reject),
  );

  return r;
}
