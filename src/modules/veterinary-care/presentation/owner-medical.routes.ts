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
  listMedicalRecordsQuerySchema,
  listVaccinationsQuerySchema,
  ownerMedicalRecordParamSchema,
  ownerVaccinationParamSchema,
} from './veterinary-care.schemas.js';

/**
 * Owner-facing veterinary-care reads. Mounted at `/animals` (alongside the
 * animals router). Reuses the animals module's ownership-scoped guards
 * (`withAnimal` + `authorizeAnimalRead`), so only the animal's current owner
 * (or ADMIN) can read. No create/update/delete — owners never mutate
 * veterinary records.
 */
export function createOwnerMedicalRouter(c: Container): Router {
  const ctrl = new OwnerMedicalController(
    c.medicalRecordService,
    c.vaccinationService,
    c.medicalHistoryService,
  );
  const { withAnimal, authorizeAnimalRead } = createAnimalMiddleware({
    animals: c.animalService,
    authz: c.authorizationService,
  });

  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/:animalId/medical-records',
    validate({ params: animalIdParamSchema, query: listMedicalRecordsQuerySchema }),
    withAnimal,
    authorizeAnimalRead('animal.read'),
    asyncHandler(ctrl.listRecords),
  );
  r.get(
    '/:animalId/medical-records/:recordId',
    validate({ params: ownerMedicalRecordParamSchema }),
    withAnimal,
    authorizeAnimalRead('animal.read'),
    asyncHandler(ctrl.getRecord),
  );
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
