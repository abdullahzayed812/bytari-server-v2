import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { TransferRequestController } from './transfer-request.controller.js';
import { animalIdParamSchema, createAnimalMiddleware } from './animal.middleware.js';
import {
  createTransferRequestBodySchema,
  listTransferRequestsQuerySchema,
  rejectTransferRequestBodySchema,
  transferRequestIdParamSchema,
} from './transfer-request.schemas.js';

/**
 * `/animals/:animalId/transfer-requests` — create only. Current-owner-only,
 * same `authorizeAnimalWrite` guard as the instant transfer endpoint (spec §4);
 * 404 (not 403) for a non-owner, so an animal's existence/ownership is never
 * revealed to a caller who doesn't already have access to it.
 */
export function createAnimalTransferRequestRouter(c: Container): Router {
  const ctrl = new TransferRequestController(c.animalTransferRequestService);
  const { withAnimal, authorizeAnimalWrite } = createAnimalMiddleware({
    animals: c.animalService,
    authz: c.authorizationService,
  });
  const r = Router();
  r.use(c.authenticate);

  r.post(
    '/:animalId/transfer-requests',
    validate({ params: animalIdParamSchema, body: createTransferRequestBodySchema }),
    withAnimal,
    authorizeAnimalWrite(),
    asyncHandler(ctrl.create),
  );

  return r;
}

/**
 * `/animal-transfer-requests*` — "My transfer requests" (sent + received) and
 * responding to one. Every action beyond create is scoped to the sender or
 * recipient inside the service (never by role) — a request unrelated to the
 * caller 404s, never 403, so its existence is not revealed either.
 */
export function createTransferRequestRouter(c: Container): Router {
  const ctrl = new TransferRequestController(c.animalTransferRequestService);
  const r = Router();
  r.use(c.authenticate);

  r.get('/sent', validate({ query: listTransferRequestsQuerySchema }), asyncHandler(ctrl.listSent));
  r.get(
    '/received',
    validate({ query: listTransferRequestsQuerySchema }),
    asyncHandler(ctrl.listReceived),
  );
  r.get(
    '/:requestId',
    validate({ params: transferRequestIdParamSchema }),
    asyncHandler(ctrl.getOne),
  );
  r.post(
    '/:requestId/accept',
    validate({ params: transferRequestIdParamSchema }),
    asyncHandler(ctrl.accept),
  );
  r.post(
    '/:requestId/reject',
    validate({ params: transferRequestIdParamSchema, body: rejectTransferRequestBodySchema }),
    asyncHandler(ctrl.reject),
  );
  r.post(
    '/:requestId/cancel',
    validate({ params: transferRequestIdParamSchema }),
    asyncHandler(ctrl.cancel),
  );

  return r;
}
