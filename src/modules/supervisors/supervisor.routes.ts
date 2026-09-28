import { Router } from 'express';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { validate } from '../../shared/http/validate.js';
import { idParamSchema } from '../../shared/validation/common.js';
import type { Container } from '../../container.js';
import { sendSuccess } from '../../shared/http/response.js';
import { SUPERVISOR_DOMAIN_PERMISSIONS, SUPERVISOR_DOMAINS } from '../rbac/rbac.constants.js';
import { SupervisorController } from './supervisor.controller.js';
import {
  assignSupervisorBodySchema,
  listSupervisorsQuerySchema,
  setSupervisorDomainsBodySchema,
} from './supervisor.schemas.js';

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
  // The assignable management sections + what each grants — the supervisor
  // form is built from this, never from a hard-coded client list.
  r.get('/domains', authorize('supervisor.read'), (_req, res) => {
    sendSuccess(
      res,
      SUPERVISOR_DOMAINS.map((domain) => ({
        domain,
        permissions: [...SUPERVISOR_DOMAIN_PERMISSIONS[domain]],
      })),
    );
  });
  r.post(
    '/',
    authorize('supervisor.assign'),
    validate({ body: assignSupervisorBodySchema }),
    asyncHandler(ctrl.assign),
  );
  // Several management sections per supervisor. Needs BOTH assign and remove.
  r.put(
    '/domains',
    authorize('supervisor.assign'),
    authorize('supervisor.remove'),
    validate({ body: setSupervisorDomainsBodySchema }),
    asyncHandler(ctrl.setDomains),
  );
  r.delete(
    '/:id',
    authorize('supervisor.remove'),
    validate({ params: idParamSchema }),
    asyncHandler(ctrl.remove),
  );

  return r;
}
