import { Router } from 'express';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { validate } from '../../shared/http/validate.js';
import type { Container } from '../../container.js';
import { AuthController } from './auth.controller.js';
import { authRateLimiter } from './auth.rate-limit.js';
import {
  loginBodySchema,
  logoutBodySchema,
  refreshBodySchema,
  registerBodySchema,
  resendVerificationBodySchema,
  verifyEmailBodySchema,
} from './auth.schemas.js';

/** Mounts `/auth/*`. */
export function createAuthRouter(c: Container): Router {
  const controller = new AuthController(
    c.authService,
    c.userService,
    c.authorizationService,
    c.supervisorService,
  );
  const router = Router();
  const limiter = authRateLimiter(c.config);

  router.post(
    '/register',
    limiter,
    validate({ body: registerBodySchema }),
    asyncHandler(controller.register),
  );
  router.post(
    '/login',
    limiter,
    validate({ body: loginBodySchema }),
    asyncHandler(controller.login),
  );
  router.post(
    '/verify-email',
    limiter,
    validate({ body: verifyEmailBodySchema }),
    asyncHandler(controller.verifyEmail),
  );
  router.post(
    '/resend-verification',
    limiter,
    validate({ body: resendVerificationBodySchema }),
    asyncHandler(controller.resendVerification),
  );
  router.post(
    '/refresh',
    limiter,
    validate({ body: refreshBodySchema }),
    asyncHandler(controller.refresh),
  );
  router.post(
    '/logout',
    c.authenticate,
    validate({ body: logoutBodySchema }),
    asyncHandler(controller.logout),
  );
  router.post('/logout-all', c.authenticate, asyncHandler(controller.logoutAll));
  // A freshly-registered, not-yet-verified account must be able to read its
  // own `/auth/me` — it's how the mobile client detects `PENDING_VERIFICATION`
  // and routes to the verify screen instead of the main app.
  router.get('/me', c.authenticatePendingOk, asyncHandler(controller.me));

  return router;
}
