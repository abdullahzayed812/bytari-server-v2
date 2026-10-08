import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { userRateLimiter } from '../../../shared/http/user-rate-limit.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import {
  createOrganizationMiddleware,
  organizationIdParamSchema,
  requireOrganization,
} from '../../organizations/presentation/organization.middleware.js';
import { createOrganizationSubscriptionGuard } from '../../organizations/presentation/organization-subscription.middleware.js';
import { VeterinaryCarePolicy } from '../domain/veterinary-care.policy.js';
import { ClinicalController } from './clinical.controller.js';
import { createVeterinaryCareMiddleware } from './veterinary-care.middleware.js';
import {
  clinicAnimalParamSchema,
  createMedicalRecordBodySchema,
  createVaccinationBodySchema,
  clinicPetLookupQuerySchema,
  listClinicPetsQuerySchema,
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
 *                → operability guard → withClinicAnimal (registered pet)
 *
 * There is no clinic ↔ pet link: the per-row rule lives in the services —
 * every read and write is restricted to rows whose `organization_id` is the
 * URL clinic (whose membership + permission were just verified), so a clinic
 * only ever sees and changes its own work. ADMIN acts as the URL clinic.
 */
/** MUST run after `withOrganization` — non-CLINIC organizations get 400 ORGANIZATION_TYPE_NOT_SUPPORTED. */
const withClinic: RequestHandler = asyncHandler((req, _res, next) => {
  VeterinaryCarePolicy.assertVeterinaryOrgType(requireOrganization(req));
  next();
});

export function createClinicalVeterinaryRouter(c: Container): Router {
  const ctrl = new ClinicalController(
    c.clinicPetService,
    c.medicalRecordService,
    c.vaccinationService,
    c.medicalHistoryService,
  );
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });
  const { withClinicAnimal } = createVeterinaryCareMiddleware({ animals: c.animalRepository });

  // Clinic operability (single rule: ACTIVE status — via authorizeOrg — and a
  // non-expired subscription). Applies to owner AND staff; ADMIN bypasses.
  const activeSubscription = createOrganizationSubscriptionGuard({
    subscriptions: c.farmSubscriptionRenewalRepository,
    authz: c.authorizationService,
  });

  const r = Router();
  r.use(c.authenticate);

  // --- clinic pets: Recent / All Pets + open-by-code ---------------
  // Lookups are rate-limited per user: a short public ID is guessable in
  // principle, so bulk enumeration is throttled (and every hit is audited).
  const lookupLimiter = userRateLimiter(c.config, { windowMs: 60 * 60 * 1000, max: 120 });
  r.get(
    '/:organizationId/clinic-pets',
    validate({ params: organizationIdParamSchema, query: listClinicPetsQuerySchema }),
    withOrganization,
    withClinic,
    authorizeOrg('animal.veterinary.access.read'),
    activeSubscription,
    asyncHandler(ctrl.listPets),
  );
  r.get(
    '/:organizationId/clinic-pets/lookup',
    validate({ params: organizationIdParamSchema, query: clinicPetLookupQuerySchema }),
    withOrganization,
    withClinic,
    authorizeOrg('animal.veterinary.access.read'),
    activeSubscription,
    lookupLimiter,
    asyncHandler(ctrl.lookupPet),
  );

  // --- medical records ------------------------------------------
  const recordsBase = '/:organizationId/animals/:animalId/medical-records';
  r.get(
    recordsBase,
    validate({ params: clinicAnimalParamSchema, query: listMedicalRecordsQuerySchema }),
    withOrganization,
    authorizeOrg('medical_record.read'),
    activeSubscription,
    withClinicAnimal,
    asyncHandler(ctrl.listRecords),
  );
  r.post(
    recordsBase,
    validate({ params: clinicAnimalParamSchema, body: createMedicalRecordBodySchema }),
    withOrganization,
    authorizeOrg('medical_record.create'),
    activeSubscription,
    withClinicAnimal,
    asyncHandler(ctrl.createRecord),
  );
  r.get(
    `${recordsBase}/:recordId`,
    validate({ params: medicalRecordParamSchema }),
    withOrganization,
    authorizeOrg('medical_record.read'),
    activeSubscription,
    withClinicAnimal,
    asyncHandler(ctrl.getRecord),
  );
  r.patch(
    `${recordsBase}/:recordId`,
    validate({ params: medicalRecordParamSchema, body: updateMedicalRecordBodySchema }),
    withOrganization,
    authorizeOrg('medical_record.update'),
    activeSubscription,
    withClinicAnimal,
    asyncHandler(ctrl.updateRecord),
  );
  r.delete(
    `${recordsBase}/:recordId`,
    validate({ params: medicalRecordParamSchema }),
    withOrganization,
    authorizeOrg('medical_record.delete'),
    activeSubscription,
    withClinicAnimal,
    asyncHandler(ctrl.deleteRecord),
  );

  // --- vaccinations -------------------------------------------
  const vaxBase = '/:organizationId/animals/:animalId/vaccinations';
  r.get(
    vaxBase,
    validate({ params: clinicAnimalParamSchema, query: listVaccinationsQuerySchema }),
    withOrganization,
    authorizeOrg('vaccination.read'),
    activeSubscription,
    withClinicAnimal,
    asyncHandler(ctrl.listVaccinations),
  );
  r.post(
    vaxBase,
    validate({ params: clinicAnimalParamSchema, body: createVaccinationBodySchema }),
    withOrganization,
    authorizeOrg('vaccination.create'),
    activeSubscription,
    withClinicAnimal,
    asyncHandler(ctrl.createVaccination),
  );
  r.get(
    `${vaxBase}/:vaccinationId`,
    validate({ params: vaccinationParamSchema }),
    withOrganization,
    authorizeOrg('vaccination.read'),
    activeSubscription,
    withClinicAnimal,
    asyncHandler(ctrl.getVaccination),
  );
  r.patch(
    `${vaxBase}/:vaccinationId`,
    validate({ params: vaccinationParamSchema, body: updateVaccinationBodySchema }),
    withOrganization,
    authorizeOrg('vaccination.update'),
    activeSubscription,
    withClinicAnimal,
    asyncHandler(ctrl.updateVaccination),
  );
  r.delete(
    `${vaxBase}/:vaccinationId`,
    validate({ params: vaccinationParamSchema }),
    withOrganization,
    authorizeOrg('vaccination.delete'),
    activeSubscription,
    withClinicAnimal,
    asyncHandler(ctrl.deleteVaccination),
  );

  // --- medical history (composed read model: records + vaccinations) ---
  r.get(
    '/:organizationId/animals/:animalId/medical-history',
    validate({ params: clinicAnimalParamSchema, query: listMedicalHistoryQuerySchema }),
    withOrganization,
    authorizeOrg('medical_record.read'),
    activeSubscription,
    withClinicAnimal,
    asyncHandler(ctrl.timeline),
  );

  return r;
}
