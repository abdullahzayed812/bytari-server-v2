import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import {
  animalIdParamSchema,
  createAnimalMiddleware,
} from '../../animals/presentation/animal.middleware.js';
import { OwnerMedicalController } from './owner-medical.controller.js';
import {
  listMedicalHistoryQuerySchema,
  listVaccinationsQuerySchema,
  ownerVaccinationParamSchema,
} from './veterinary-care.schemas.js';

/**
 * Owner-facing veterinary-care reads. Mounted at `/animals` (alongside the
 * animals router). Reuses the animals module's ownership-scoped guards
 * (`withAnimal` + `authorizeAnimalRead`), so only the animal's current owner
 * (or ADMIN) can read. Exposes ONLY the owner-visible kinds — vaccinations
 * and the vaccinations-only history; clinic medical records (diagnoses,
 * treatments, notes, lab, files) have no owner route at all. No
 * create/update/delete — owners never mutate clinic-created data.
 */
export function createOwnerMedicalRouter(c: Container): Router {
  const ctrl = new OwnerMedicalController(c.vaccinationService, c.medicalHistoryService);
  const { withAnimal, authorizeAnimalRead } = createAnimalMiddleware({
    animals: c.animalService,
    authz: c.authorizationService,
  });

  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/:animalId/vaccinations',
    validate({ params: animalIdParamSchema, query: listVaccinationsQuerySchema }),
    withAnimal,
    authorizeAnimalRead('animal.read'),
    asyncHandler(ctrl.listVaccinations),
  );
  r.get(
    '/:animalId/vaccinations/:vaccinationId',
    validate({ params: ownerVaccinationParamSchema }),
    withAnimal,
    authorizeAnimalRead('animal.read'),
    asyncHandler(ctrl.getVaccination),
  );

  // --- owner-facing medical history (composed timeline) ---------
  r.get(
    '/:animalId/medical-history',
    validate({ params: animalIdParamSchema, query: listMedicalHistoryQuerySchema }),
    withAnimal,
    authorizeAnimalRead('animal.read'),
    asyncHandler(ctrl.timeline),
  );

  return r;
}
