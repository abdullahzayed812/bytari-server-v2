import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import {
  AdminVetCourseController,
  AdminVetCourseRegistrationController,
} from './admin-vet-course.controller.js';
import {
  VetCourseController,
  VetCourseImageController,
  VetCourseRegistrationController,
} from './vet-course.controllers.js';
import {
  courseBrowseQuerySchema,
  createCourseBodySchema,
  createRegistrationBodySchema,
  idParamSchema,
  imageUploadUrlBodySchema,
  mineQuerySchema,
  moderationQuerySchema,
  registrationListQuerySchema,
  rejectBodySchema,
  updateCourseBodySchema,
} from './vet-course.schemas.js';

/**
 * `/vet-courses/*` — Veterinarian Courses & Seminars. Every route is
 * authentication-only at the router level; role / ownership decisions live in
 * the services (only an approved veterinarian may create a course or
 * register; only the creator or a VET_COURSES moderator manages a
 * submission; registration access is scoped to the course's creator and the
 * registrant). Moderation lives under `/admin/vet-courses*`.
 */
export function createVetCourseRouter(c: Container): Router {
  const images = new VetCourseImageController(c.vetCourseMedia);
  const courses = new VetCourseController(c.vetCourseService);
  const registrations = new VetCourseRegistrationController(c.vetCourseRegistrationService);

  const r = Router();
  r.use(c.authenticate);

  // --- cover image upload -------------------------------------
  r.post(
    '/images/upload-url',
    validate({ body: imageUploadUrlBodySchema }),
    asyncHandler(images.uploadUrl),
  );

  // --- courses / seminars / workshops ------------------------------------
  r.get('/', validate({ query: courseBrowseQuerySchema }), asyncHandler(courses.listPublic));
  r.post('/', validate({ body: createCourseBodySchema }), asyncHandler(courses.create));
  r.get('/mine', validate({ query: mineQuerySchema }), asyncHandler(courses.listMine));
  r.get('/:id', validate({ params: idParamSchema }), asyncHandler(courses.getPublic));
  r.get('/:id/manage', validate({ params: idParamSchema }), asyncHandler(courses.getMine));
  r.patch(
    '/:id',
    validate({ params: idParamSchema, body: updateCourseBodySchema }),
    asyncHandler(courses.update),
  );
  r.delete('/:id', validate({ params: idParamSchema }), asyncHandler(courses.remove));
  r.post('/:id/cancel', validate({ params: idParamSchema }), asyncHandler(courses.cancel));

  // registrations on ONE course (register + the creator's own registrant list)
  r.post(
    '/:id/registrations',
    validate({ params: idParamSchema, body: createRegistrationBodySchema }),
    asyncHandler(registrations.register),
  );
  r.get(
    '/:id/registrations',
    validate({ params: idParamSchema, query: registrationListQuerySchema }),
    asyncHandler(registrations.listForCourse),
  );

  // --- registrations: my own submissions ---------------------------------
  r.get(
    '/registrations/mine',
    validate({ query: registrationListQuerySchema }),
    asyncHandler(registrations.listMine),
  );
  r.get(
    '/registrations/:id',
    validate({ params: idParamSchema }),
    asyncHandler(registrations.getOne),
  );

  return r;
}

/** `/admin/vet-courses*` — moderation + registration oversight. */
export function createAdminVetCourseRouter(c: Container): Router {
  const courses = new AdminVetCourseController(c.vetCourseService);
  const registrations = new AdminVetCourseRegistrationController(c.vetCourseRegistrationService);
  const { authorize } = c.authorization;
  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/vet-courses',
    authorize('vet_course.read'),
    validate({ query: moderationQuerySchema }),
    asyncHandler(courses.list),
  );
  r.get(
    '/vet-courses/:id',
    authorize('vet_course.read'),
    validate({ params: idParamSchema }),
    asyncHandler(courses.getOne),
  );
  r.post(
    '/vet-courses/:id/approve',
    authorize('vet_course.approve'),
    validate({ params: idParamSchema }),
    asyncHandler(courses.approve),
  );
  r.post(
    '/vet-courses/:id/reject',
    authorize('vet_course.reject'),
    validate({ params: idParamSchema, body: rejectBodySchema }),
    asyncHandler(courses.reject),
  );
  r.post(
    '/vet-courses/:id/cancel',
    authorize('vet_course.approve'),
    validate({ params: idParamSchema }),
    asyncHandler(courses.cancel),
  );
  r.get(
    '/vet-courses/:id/registrations',
    authorize('vet_course.read'),
    validate({ params: idParamSchema, query: registrationListQuerySchema }),
    asyncHandler(registrations.listForCourse),
  );

  return r;
}
