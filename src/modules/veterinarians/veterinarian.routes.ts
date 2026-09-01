import { Router } from 'express';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { validate } from '../../shared/http/validate.js';
import { userRateLimiter } from '../../shared/http/user-rate-limit.js';
import { userIdParamSchema } from '../../shared/validation/common.js';
import type { Container } from '../../container.js';
import { VeterinarianController } from './veterinarian.controller.js';
import {
  applyBodySchema,
  documentUploadUrlBodySchema,
  pendingQuerySchema,
  rejectBodySchema,
} from './veterinarian.schemas.js';

const APPLICATION_RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 20 };

/**
 * `self`  → `/veterinarians/*`        (authenticated users)
 * `admin` → `/admin/veterinarians/*`  (permission-guarded)
 */
export function createVeterinarianRouters(c: Container): { self: Router; admin: Router } {
  const ctrl = new VeterinarianController(c.veterinarianService);
  const { authorize } = c.authorization;
  const limiter = userRateLimiter(c.config, APPLICATION_RATE_LIMIT);

  const self = Router();
  self.use(c.authenticate);
  self.post('/apply', limiter, validate({ body: applyBodySchema }), asyncHandler(ctrl.apply));
  self.post(
    '/documents/upload-url',
    limiter,
    validate({ body: documentUploadUrlBodySchema }),
    asyncHandler(ctrl.requestDocumentUploadUrl),
  );
  self.get('/me/status', asyncHandler(ctrl.myStatus));

  const admin = Router();
  admin.use(c.authenticate);
  admin.get(
    '/pending',
    authorize('veterinarian.read'),
    validate({ query: pendingQuerySchema }),
    asyncHandler(ctrl.listPending),
  );
  admin.post(
    '/:userId/approve',
    authorize('veterinarian.approve'),
    validate({ params: userIdParamSchema }),
    asyncHandler(ctrl.approve),
  );
  admin.post(
    '/:userId/reject',
    authorize('veterinarian.reject'),
    validate({ params: userIdParamSchema, body: rejectBodySchema }),
    asyncHandler(ctrl.reject),
  );

  return { self, admin };
}
