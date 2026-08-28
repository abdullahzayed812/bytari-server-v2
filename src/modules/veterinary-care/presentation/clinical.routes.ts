import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import {
  createOrganizationMiddleware,
  organizationIdParamSchema,
} from '../../organizations/presentation/organization.middleware.js';
import { ClinicalController } from './clinical.controller.js';
import { createVeterinaryCareMiddleware } from './veterinary-care.middleware.js';
import {
  clinicAnimalParamSchema,
  createMedicalRecordBodySchema,
  createVaccinationBodySchema,
  grantAnimalAccessBodySchema,
  listClinicAnimalsQuerySchema,
  listMedicalHistoryQuerySchema,
  listMedicalRecordsQuerySchema,
  listVaccinationsQuerySchema,
  medicalRecordParamSchema,
  updateMedicalRecordBodySchema,
  updateVaccinationBodySchema,
  vaccinationParamSchema,
} from './veterinary-care.schemas.js';

/**
 * Clinic-facing veterinary care. Mounted at `/organizations` (alongside the
 * organizations router). Every route is:
 *
 *   authenticate → validate → withOrganization → authorizeOrg(<org perm>)
 *                → withVeterinaryAnimalAccess (dedicated per-animal access gate)
 *
 * so a caller must be an ACTIVE member of the clinic with the right org
 * permission AND the clinic must hold an ACTIVE veterinary-access grant for the
 * animal. ADMIN overrides both.
 */
export function createClinicalVeterinaryRouter(c: Container): Router {
  const ctrl = new ClinicalController(
    c.veterinaryAccessService,
    c.medicalRecordService,
    c.vaccinationService,
    c.medicalHistoryService,
  );
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });
  const { withVeterinaryAnimalAccess } = createVeterinaryCareMiddleware({
    animals: c.animalRepository,
    access: c.veterinaryAccessService,
    authz: c.authorizationService,
  });

  const r = Router();
  r.use(c.authenticate);

  // --- clinic ↔ animal veterinary-access grants -------------------
  r.get(
    '/:organizationId/animal-access',
    validate({ params: organizationIdParamSchema, query: listClinicAnimalsQuerySchema }),
    withOrganization,
    authorizeOrg('animal.veterinary.access.read'),
    asyncHandler(ctrl.listAccess),
  );
  r.post(
    '/:organizationId/animal-access',
    validate({ params: organizationIdParamSchema, body: grantAnimalAccessBodySchema }),
    withOrganization,
    authorizeOrg('animal.veterinary.access.manage'),
    asyncHandler(ctrl.grantAccess),
  );
  r.delete(
    '/:organizationId/animal-access/:animalId',
    validate({ params: clinicAnimalParamSchema }),
    withOrganization,
    authorizeOrg('animal.veterinary.access.manage'),
    asyncHandler(ctrl.revokeAccess),
  );

  // --- medical records ------------------------------------------
  const recordsBase = '/:organizationId/animals/:animalId/medical-records';
  r.get(
    recordsBase,
    validate({ params: clinicAnimalParamSchema, query: listMedicalRecordsQuerySchema }),
    withOrganization,
    authorizeOrg('medical_record.read'),
    withVeterinaryAnimalAccess,
    asyncHandler(ctrl.listRecords),
  );
  r.post(
    recordsBase,
    validate({ params: clinicAnimalParamSchema, body: createMedicalRecordBodySchema }),
    withOrganization,
    authorizeOrg('medical_record.create'),
    withVeterinaryAnimalAccess,
    asyncHandler(ctrl.createRecord),
  );
  r.get(
    `${recordsBase}/:recordId`,
    validate({ params: medicalRecordParamSchema }),
    withOrganization,
    authorizeOrg('medical_record.read'),
    withVeterinaryAnimalAccess,
    asyncHandler(ctrl.getRecord),
  );
  r.patch(
    `${recordsBase}/:recordId`,
    validate({ params: medicalRecordParamSchema, body: updateMedicalRecordBodySchema }),
    withOrganization,
    authorizeOrg('medical_record.update'),
    withVeterinaryAnimalAccess,
    asyncHandler(ctrl.updateRecord),
  );
  r.delete(
    `${recordsBase}/:recordId`,
    validate({ params: medicalRecordParamSchema }),
    withOrganization,
    authorizeOrg('medical_record.delete'),
    withVeterinaryAnimalAccess,
    asyncHandler(ctrl.deleteRecord),
  );

  // --- vaccinations -------------------------------------------
  const vaxBase = '/:organizationId/animals/:animalId/vaccinations';
  r.get(
    vaxBase,
    validate({ params: clinicAnimalParamSchema, query: listVaccinationsQuerySchema }),
    withOrganization,
    authorizeOrg('vaccination.read'),
    withVeterinaryAnimalAccess,
    asyncHandler(ctrl.listVaccinations),
  );
  r.post(
    vaxBase,
    validate({ params: clinicAnimalParamSchema, body: createVaccinationBodySchema }),
    withOrganization,
    authorizeOrg('vaccination.create'),
    withVeterinaryAnimalAccess,
    asyncHandler(ctrl.createVaccination),
  );
  r.get(
    `${vaxBase}/:vaccinationId`,
    validate({ params: vaccinationParamSchema }),
    withOrganization,
    authorizeOrg('vaccination.read'),
    withVeterinaryAnimalAccess,
    asyncHandler(ctrl.getVaccination),
  );
  r.patch(
    `${vaxBase}/:vaccinationId`,
    validate({ params: vaccinationParamSchema, body: updateVaccinationBodySchema }),
    withOrganization,
    authorizeOrg('vaccination.update'),
    withVeterinaryAnimalAccess,
    asyncHandler(ctrl.updateVaccination),
  );
  r.delete(
    `${vaxBase}/:vaccinationId`,
    validate({ params: vaccinationParamSchema }),
    withOrganization,
    authorizeOrg('vaccination.delete'),
    withVeterinaryAnimalAccess,
    asyncHandler(ctrl.deleteVaccination),
  );

  // --- medical history (composed read model: records + vaccinations) ---
  r.get(
    '/:organizationId/animals/:animalId/medical-history',
    validate({ params: clinicAnimalParamSchema, query: listMedicalHistoryQuerySchema }),
    withOrganization,
    authorizeOrg('medical_record.read'),
    withVeterinaryAnimalAccess,
    asyncHandler(ctrl.timeline),
  );

  return r;
}
