import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createContentAuthz } from './content.middleware.js';
import { TipController } from './tip.controller.js';
import {
  coverUploadUrlBodySchema,
  createTipBodySchema,
  listAdminTipsQuerySchema,
  listPublicTipsQuerySchema,
  registerCoverBodySchema,
  tipIdParamSchema,
  tipOfDayBodySchema,
  updateTipBodySchema,
} from './tip.schemas.js';

/**
 * Public tips — authenticated users, PUBLISHED & not-deleted only. Bookmark /
 * helpful toggles are auth + self only (no permission key).
 */
export function createTipRouter(c: Container): Router {
  const ctrl = new TipController(c.tipService);
  const r = Router();
  r.use(c.authenticate);

  r.get('/', validate({ query: listPublicTipsQuerySchema }), asyncHandler(ctrl.listPublic));
  r.get('/tip-of-the-day', asyncHandler(ctrl.tipOfTheDay));
  r.get('/:tipId', validate({ params: tipIdParamSchema }), asyncHandler(ctrl.getPublic));
  r.post('/:tipId/bookmark', validate({ params: tipIdParamSchema }), asyncHandler(ctrl.bookmark));
  r.delete(
    '/:tipId/bookmark',
    validate({ params: tipIdParamSchema }),
    asyncHandler(ctrl.unbookmark),
  );
  r.post('/:tipId/helpful', validate({ params: tipIdParamSchema }), asyncHandler(ctrl.markHelpful));
  r.delete(
    '/:tipId/helpful',
    validate({ params: tipIdParamSchema }),
    asyncHandler(ctrl.unmarkHelpful),
  );
  return r;
}

/**
 * `/admin/tips*` — `authenticate → authorizeContent('content.*') → controller`.
 * Same guard as content: ADMIN override or an approved-vet CONTENT
 * system-supervisor. `content.delete` (soft-delete / restore) is ADMIN-only.
 */
export function createAdminTipRouter(c: Container): Router {
  const ctrl = new TipController(c.tipService);
  const { authorizeContent } = createContentAuthz(c.authorizationService);

  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/',
    authorizeContent('content.read'),
    validate({ query: listAdminTipsQuerySchema }),
    asyncHandler(ctrl.listAdmin),
  );
  r.post(
    '/',
    authorizeContent('content.create'),
    validate({ body: createTipBodySchema }),
    asyncHandler(ctrl.create),
  );
  r.get(
    '/:tipId',
    authorizeContent('content.read'),
    validate({ params: tipIdParamSchema }),
    asyncHandler(ctrl.getAdmin),
  );
  r.patch(
    '/:tipId',
    authorizeContent('content.update'),
    validate({ params: tipIdParamSchema, body: updateTipBodySchema }),
    asyncHandler(ctrl.update),
  );
  r.delete(
    '/:tipId',
    authorizeContent('content.delete'),
    validate({ params: tipIdParamSchema }),
    asyncHandler(ctrl.remove),
  );
  r.post(
    '/:tipId/restore',
    authorizeContent('content.delete'),
    validate({ params: tipIdParamSchema }),
    asyncHandler(ctrl.restore),
  );
  r.post(
    '/:tipId/publish',
    authorizeContent('content.publish'),
    validate({ params: tipIdParamSchema }),
    asyncHandler(ctrl.publish),
  );
  r.post(
    '/:tipId/archive',
    authorizeContent('content.archive'),
    validate({ params: tipIdParamSchema }),
    asyncHandler(ctrl.archive),
  );
  r.post(
    '/:tipId/tip-of-the-day',
    authorizeContent('content.publish'),
    validate({ params: tipIdParamSchema, body: tipOfDayBodySchema }),
    asyncHandler(ctrl.setTipOfDay),
  );
  r.post(
    '/:tipId/cover/upload-url',
    authorizeContent('content.upload'),
    validate({ params: tipIdParamSchema, body: coverUploadUrlBodySchema }),
    asyncHandler(ctrl.requestCoverUploadUrl),
  );
  r.post(
    '/:tipId/cover',
    authorizeContent('content.upload'),
    validate({ params: tipIdParamSchema, body: registerCoverBodySchema }),
    asyncHandler(ctrl.registerCover),
  );

  return r;
}
