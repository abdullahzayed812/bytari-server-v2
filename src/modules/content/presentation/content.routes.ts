import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { CategoryController } from './category.controller.js';
import { ContentController } from './content.controller.js';
import { createContentAuthz } from './content.middleware.js';
import {
  categoryIdParamSchema,
  contentFileParamSchema,
  contentIdParamSchema,
  createCategoryBodySchema,
  createContentBodySchema,
  listAdminContentQuerySchema,
  listPublicContentQuerySchema,
  registerFileBodySchema,
  updateCategoryBodySchema,
  updateContentBodySchema,
  uploadUrlBodySchema,
} from './content.schemas.js';

/**
 * Public content — authenticated users, PUBLISHED & not-deleted only. Draft /
 * archived / deleted items are invisible here (404 by id).
 */
export function createContentRouter(c: Container): Router {
  const ctrl = new ContentController(c.contentService);
  const r = Router();
  r.use(c.authenticate);

  r.get('/', validate({ query: listPublicContentQuerySchema }), asyncHandler(ctrl.listPublic));
  r.get('/:contentId', validate({ params: contentIdParamSchema }), asyncHandler(ctrl.getPublic));
  r.get(
    '/:contentId/files/:fileId/download',
    validate({ params: contentFileParamSchema }),
    asyncHandler(ctrl.downloadPublic),
  );
  return r;
}

/** `GET /content-categories` — any authenticated user (for filter UIs). */
export function createContentCategoryRouter(c: Container): Router {
  const ctrl = new CategoryController(c.categoryService);
  const r = Router();
  r.use(c.authenticate);
  r.get('/', asyncHandler(ctrl.list));
  return r;
}

/**
 * `/admin/content*` + `/admin/content-categories*`.
 *
 *   authenticate → authorizeContent(<permission>) → controller
 *
 * `authorizeContent` = `authz.assert` (ADMIN override / CONTENT supervisor
 * domain) AND approved-vet. `content.delete` is NOT in the CONTENT supervisor
 * domain — soft-delete / restore are ADMIN-only.
 */
export function createAdminContentRouter(c: Container): Router {
  const content = new ContentController(c.contentService);
  const category = new CategoryController(c.categoryService);
  const { authorizeContent } = createContentAuthz(c.authorizationService);

  const r = Router();
  r.use(c.authenticate);

  // --- content items ---
  r.get(
    '/content',
    authorizeContent('content.read'),
    validate({ query: listAdminContentQuerySchema }),
    asyncHandler(content.listAdmin),
  );
  r.post(
    '/content',
    authorizeContent('content.create'),
    validate({ body: createContentBodySchema }),
    asyncHandler(content.create),
  );
  r.get(
    '/content/:contentId',
    authorizeContent('content.read'),
    validate({ params: contentIdParamSchema }),
    asyncHandler(content.getAdmin),
  );
  r.patch(
    '/content/:contentId',
    authorizeContent('content.update'),
    validate({ params: contentIdParamSchema, body: updateContentBodySchema }),
    asyncHandler(content.update),
  );
  r.delete(
    '/content/:contentId',
    authorizeContent('content.delete'),
    validate({ params: contentIdParamSchema }),
    asyncHandler(content.remove),
  );
  r.post(
    '/content/:contentId/restore',
    authorizeContent('content.delete'),
    validate({ params: contentIdParamSchema }),
    asyncHandler(content.restore),
  );
  r.post(
    '/content/:contentId/publish',
    authorizeContent('content.publish'),
    validate({ params: contentIdParamSchema }),
    asyncHandler(content.publish),
  );
  r.post(
    '/content/:contentId/archive',
    authorizeContent('content.archive'),
    validate({ params: contentIdParamSchema }),
    asyncHandler(content.archive),
  );

  // --- files ---
  r.post(
    '/content/:contentId/files/upload-url',
    authorizeContent('content.upload'),
    validate({ params: contentIdParamSchema, body: uploadUrlBodySchema }),
    asyncHandler(content.requestUploadUrl),
  );
  r.post(
    '/content/:contentId/files',
    authorizeContent('content.upload'),
    validate({ params: contentIdParamSchema, body: registerFileBodySchema }),
    asyncHandler(content.registerFile),
  );
  r.get(
    '/content/:contentId/files/:fileId/download',
    authorizeContent('content.read'),
    validate({ params: contentFileParamSchema }),
    asyncHandler(content.downloadAdmin),
  );
  r.delete(
    '/content/:contentId/files/:fileId',
    authorizeContent('content.upload'),
    validate({ params: contentFileParamSchema }),
    asyncHandler(content.deleteFile),
  );

  // --- categories ---
  r.get(
    '/content-categories',
    authorizeContent('content.category.manage'),
    asyncHandler(category.list),
  );
  r.post(
    '/content-categories',
    authorizeContent('content.category.manage'),
    validate({ body: createCategoryBodySchema }),
    asyncHandler(category.create),
  );
  r.patch(
    '/content-categories/:categoryId',
    authorizeContent('content.category.manage'),
    validate({ params: categoryIdParamSchema, body: updateCategoryBodySchema }),
    asyncHandler(category.update),
  );
  r.delete(
    '/content-categories/:categoryId',
    authorizeContent('content.category.manage'),
    validate({ params: categoryIdParamSchema }),
    asyncHandler(category.remove),
  );

  return r;
}
