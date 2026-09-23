import { Router } from 'express';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { validate } from '../../shared/http/validate.js';
import { userRateLimiter } from '../../shared/http/user-rate-limit.js';
import type { Container } from '../../container.js';
import { SelfUsersController } from './self-users.controller.js';
import { avatarUploadUrlBodySchema, finalizeAvatarBodySchema } from './user.schemas.js';

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
  const ctrl = new SelfUsersController(c.userService);
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

  return r;
}
