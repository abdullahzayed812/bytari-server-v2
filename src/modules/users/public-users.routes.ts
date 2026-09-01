import { Router } from 'express';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { validate } from '../../shared/http/validate.js';
import { idParamSchema } from '../../shared/validation/common.js';
import type { Container } from '../../container.js';
import { PublicUsersController } from './public-users.controller.js';

/**
 * Mounts `/users/*` — the authenticated user directory (name-level summary
 * only). Distinct from `/admin/users/*`, which needs `user.*` permissions and
 * returns the full account record.
 *
 *   authenticate → validate(:id uuid) → controller
 */
export function createPublicUsersRouter(c: Container): Router {
  const ctrl = new PublicUsersController(c.userService);
  const r = Router();

  r.use(c.authenticate);

  r.get('/:id', validate({ params: idParamSchema }), asyncHandler(ctrl.get));

  return r;
}
