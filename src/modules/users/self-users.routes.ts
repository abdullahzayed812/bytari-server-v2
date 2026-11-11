import { Router } from 'express';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { validate } from '../../shared/http/validate.js';
import { userRateLimiter } from '../../shared/http/user-rate-limit.js';
import type { Container } from '../../container.js';
import { z } from 'zod';
import { SelfUsersController } from './self-users.controller.js';
import { UserBlockService } from './user-block.service.js';
import {
  avatarUploadUrlBodySchema,
  deleteMyAccountBodySchema,
  finalizeAvatarBodySchema,
  updateMyProfileBodySchema,
} from './user.schemas.js';

const UPLOAD_RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 20 };

/**
 * Mounts `/users/me/*` — authenticated self-service (avatar upload). Mounted
 * BEFORE `createPublicUsersRouter` (`/users/:id`) so `/users/me/*` is matched
 * first and never swallowed by the `:id` param route.
 *
 * Uses `authenticatePendingOk`, not the default `authenticate`: a
 * freshly-registered `PENDING_VERIFICATION` account must be able to set its
 * avatar in the SAME registration flow, before verifying its email — see
 * `authenticate.middleware.ts`'s `CreateAuthenticateOptions` doc comment for
 * the full, deliberately short, allowlist this belongs to.
 */
export function createSelfUsersRouter(c: Container): Router {
  const ctrl = new SelfUsersController(
    c.userService,
    c.userDeletionService,
    c.passwordService,
    new UserBlockService(c.db),
  );
  const limiter = userRateLimiter(c.config, UPLOAD_RATE_LIMIT);
  const r = Router();

  r.use(c.authenticatePendingOk);

  r.post(
    '/me/avatar/upload-url',
    limiter,
    validate({ body: avatarUploadUrlBodySchema }),
    asyncHandler(ctrl.requestAvatarUploadUrl),
  );
  r.post(
    '/me/avatar',
    limiter,
    validate({ body: finalizeAvatarBodySchema }),
    asyncHandler(ctrl.finalizeAvatar),
  );

  // Own profile edit — a fully authenticated account only (the router-level
  // pending-ok guard above is deliberately narrowed again here).
  r.patch(
    '/me',
    c.authenticate,
    limiter,
    validate({ body: updateMyProfileBodySchema }),
    asyncHandler(ctrl.updateMe),
  );

  // User blocking (Play UGC policy) — fully authenticated accounts only.
  const blockParams = z.object({ userId: z.string().uuid() });
  r.get('/me/blocks', c.authenticate, asyncHandler(ctrl.listBlocks));
  r.put(
    '/me/blocks/:userId',
    c.authenticate,
    validate({ params: blockParams }),
    asyncHandler(ctrl.block),
  );
  r.delete(
    '/me/blocks/:userId',
    c.authenticate,
    validate({ params: blockParams }),
    asyncHandler(ctrl.unblock),
  );

  // Permanent self-service account deletion (Play policy). Allowed for a
  // PENDING_VERIFICATION account too (router-level guard) — someone who
  // registered but never verified must still be able to erase the account.
  r.delete(
    '/me',
    userRateLimiter(c.config, { windowMs: 15 * 60 * 1000, max: 5 }),
    validate({ body: deleteMyAccountBodySchema }),
    asyncHandler(ctrl.deleteMe),
  );

  return r;
}
