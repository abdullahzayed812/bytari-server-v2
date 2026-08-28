import { Router } from 'express';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { validate } from '../../shared/http/validate.js';
import { idParamSchema } from '../../shared/validation/common.js';
import type { Container } from '../../container.js';
import { SupervisorController } from './supervisor.controller.js';
import { assignSupervisorBodySchema, listSupervisorsQuerySchema } from './supervisor.schemas.js';

/** Mounts `/admin/supervisors/*`. */
export function createAdminSupervisorRouter(c: Container): Router {
  const ctrl = new SupervisorController(c.supervisorService);
  const { authorize } = c.authorization;
  const r = Router();

  r.use(c.authenticate);
  r.get(
    '/',
    authorize('supervisor.read'),
    validate({ query: listSupervisorsQuerySchema }),
    asyncHandler(ctrl.list),
  );
  r.post(
    '/',
    authorize('supervisor.assign'),
    validate({ body: assignSupervisorBodySchema }),
    asyncHandler(ctrl.assign),
  );
  r.delete(
    '/:id',
    authorize('supervisor.remove'),
    validate({ params: idParamSchema }),
    asyncHandler(ctrl.remove),
  );

  return r;
}
