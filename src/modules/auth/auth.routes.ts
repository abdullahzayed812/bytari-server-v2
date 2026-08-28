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
  router.get('/me', c.authenticate, asyncHandler(controller.me));

  return router;
}
