import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createContentAuthz } from './content.middleware.js';
import { NewsController } from './news.controller.js';
import {
  createNewsBodySchema,
  featuredBodySchema,
  imageUploadUrlBodySchema,
  listAdminNewsQuerySchema,
  listPublicNewsQuerySchema,
  newsIdParamSchema,
  registerImageBodySchema,
  removeGalleryImageQuerySchema,
  updateNewsBodySchema,
} from './news.schemas.js';

/**
 * Public news — authenticated users, PUBLISHED & not-deleted only. Bookmark
 * toggles are auth + self only (no permission key). Same shape as `/tips`.
 */
export function createNewsRouter(c: Container): Router {
  const ctrl = new NewsController(c.newsService);
  const r = Router();
  r.use(c.authenticate);

  r.get('/', validate({ query: listPublicNewsQuerySchema }), asyncHandler(ctrl.listPublic));
  r.get('/featured', asyncHandler(ctrl.featured));
  r.get('/:newsId', validate({ params: newsIdParamSchema }), asyncHandler(ctrl.getPublic));
  r.post('/:newsId/bookmark', validate({ params: newsIdParamSchema }), asyncHandler(ctrl.bookmark));
  r.delete(
    '/:newsId/bookmark',
    validate({ params: newsIdParamSchema }),
    asyncHandler(ctrl.unbookmark),
  );
  return r;
}

/**
 * `/admin/news*` — `authenticate → authorizeContent('content.*') → controller`.
 * Same guard as content / tips: ADMIN override or an approved-vet CONTENT
 * system-supervisor. `content.delete` (soft-delete / restore) is ADMIN-only.
 */
export function createAdminNewsRouter(c: Container): Router {
  const ctrl = new NewsController(c.newsService);
  const { authorizeContent } = createContentAuthz(c.authorizationService);

  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/',
    authorizeContent('content.read'),
    validate({ query: listAdminNewsQuerySchema }),
    asyncHandler(ctrl.listAdmin),
  );
  r.post(
    '/',
    authorizeContent('content.create'),
    validate({ body: createNewsBodySchema }),
    asyncHandler(ctrl.create),
  );
  r.get(
    '/:newsId',
    authorizeContent('content.read'),
    validate({ params: newsIdParamSchema }),
    asyncHandler(ctrl.getAdmin),
  );
  r.patch(
    '/:newsId',
    authorizeContent('content.update'),
    validate({ params: newsIdParamSchema, body: updateNewsBodySchema }),
    asyncHandler(ctrl.update),
  );
  r.delete(
    '/:newsId',
    authorizeContent('content.delete'),
    validate({ params: newsIdParamSchema }),
    asyncHandler(ctrl.remove),
  );
  r.post(
    '/:newsId/restore',
    authorizeContent('content.delete'),
    validate({ params: newsIdParamSchema }),
    asyncHandler(ctrl.restore),
  );
  r.post(
    '/:newsId/publish',
    authorizeContent('content.publish'),
    validate({ params: newsIdParamSchema }),
    asyncHandler(ctrl.publish),
  );
  r.post(
    '/:newsId/archive',
    authorizeContent('content.archive'),
    validate({ params: newsIdParamSchema }),
    asyncHandler(ctrl.archive),
  );
  r.post(
    '/:newsId/featured',
    authorizeContent('content.publish'),
    validate({ params: newsIdParamSchema, body: featuredBodySchema }),
    asyncHandler(ctrl.setFeatured),
  );
  r.post(
    '/:newsId/cover/upload-url',
    authorizeContent('content.upload'),
    validate({ params: newsIdParamSchema, body: imageUploadUrlBodySchema }),
    asyncHandler(ctrl.requestCoverUploadUrl),
  );
  r.post(
    '/:newsId/cover',
    authorizeContent('content.upload'),
    validate({ params: newsIdParamSchema, body: registerImageBodySchema }),
    asyncHandler(ctrl.registerCover),
  );
  r.post(
    '/:newsId/gallery/upload-url',
    authorizeContent('content.upload'),
    validate({ params: newsIdParamSchema, body: imageUploadUrlBodySchema }),
    asyncHandler(ctrl.requestGalleryUploadUrl),
  );
  r.post(
    '/:newsId/gallery',
    authorizeContent('content.upload'),
    validate({ params: newsIdParamSchema, body: registerImageBodySchema }),
    asyncHandler(ctrl.addGalleryImage),
  );
  r.delete(
    '/:newsId/gallery',
    authorizeContent('content.upload'),
    validate({ params: newsIdParamSchema, query: removeGalleryImageQuerySchema }),
    asyncHandler(ctrl.removeGalleryImage),
  );

  return r;
}
