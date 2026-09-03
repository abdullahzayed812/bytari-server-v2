import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { AnimalController } from './animal.controller.js';
import { animalIdParamSchema, createAnimalMiddleware } from './animal.middleware.js';
import {
  animalGalleryUploadUrlBodySchema,
  createAnimalBodySchema,
  finalizeAnimalGalleryBodySchema,
  listAnimalsQuerySchema,
  removeAnimalGalleryImageQuerySchema,
  updateAnimalBodySchema,
} from './animal.schemas.js';

/**
 * Mounts `/animals/*`.
 *
 * Collection routes (`POST` / `GET /animals`) are authentication-only and
 * self-scoped in the service. Item routes resolve `:animalId` via `withAnimal`
 * then apply ownership-scoped authorization (owner-or-ADMIN; read paths also
 * accept a reserved `animal.*` permission holder).
 */
export function createAnimalRouter(c: Container): Router {
  const ctrl = new AnimalController(c.animalService, c.animalOwnershipService);
  const { withAnimal, authorizeAnimalRead, authorizeAnimalWrite } = createAnimalMiddleware({
    animals: c.animalService,
    authz: c.authorizationService,
  });
  const r = Router();
  r.use(c.authenticate);

  r.post('/', validate({ body: createAnimalBodySchema }), asyncHandler(ctrl.create));
  r.get('/', validate({ query: listAnimalsQuerySchema }), asyncHandler(ctrl.list));

  r.get(
    '/:animalId',
    validate({ params: animalIdParamSchema }),
    withAnimal,
    authorizeAnimalRead('animal.read'),
    asyncHandler(ctrl.getOne),
  );
  r.patch(
    '/:animalId',
    validate({ params: animalIdParamSchema, body: updateAnimalBodySchema }),
    withAnimal,
    authorizeAnimalWrite(),
    asyncHandler(ctrl.update),
  );
  r.delete(
    '/:animalId',
    validate({ params: animalIdParamSchema }),
    withAnimal,
    authorizeAnimalWrite(),
    asyncHandler(ctrl.deactivate),
  );

  r.get(
    '/:animalId/ownership/history',
    validate({ params: animalIdParamSchema }),
    withAnimal,
    authorizeAnimalRead('animal.ownership.read'),
    asyncHandler(ctrl.history),
  );

  // --- gallery — owner (or ADMIN) only, same guard as write ------
  r.post(
    '/:animalId/gallery/upload-url',
    validate({ params: animalIdParamSchema, body: animalGalleryUploadUrlBodySchema }),
    withAnimal,
    authorizeAnimalWrite(),
    asyncHandler(ctrl.requestGalleryUploadUrl),
  );
  r.post(
    '/:animalId/gallery',
    validate({ params: animalIdParamSchema, body: finalizeAnimalGalleryBodySchema }),
    withAnimal,
    authorizeAnimalWrite(),
    asyncHandler(ctrl.addGalleryImage),
  );
  r.delete(
    '/:animalId/gallery',
    validate({ params: animalIdParamSchema, query: removeAnimalGalleryImageQuerySchema }),
    withAnimal,
    authorizeAnimalWrite(),
    asyncHandler(ctrl.removeGalleryImage),
  );

  return r;
}
