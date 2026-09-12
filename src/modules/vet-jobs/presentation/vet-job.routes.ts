import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import {
  AdminVetJobApplicationController,
  AdminVetJobOfferController,
  AdminVetJobSeekerProfileController,
} from './admin-vet-job.controller.js';
import {
  VetJobApplicationController,
  VetJobAttachmentController,
  VetJobOfferController,
  VetJobSeekerProfileController,
} from './vet-job.controllers.js';
import {
  applicationListQuerySchema,
  attachmentUploadUrlBodySchema,
  createApplicationBodySchema,
  createOfferBodySchema,
  createSeekerProfileBodySchema,
  idParamSchema,
  mineQuerySchema,
  moderationQuerySchema,
  offerBrowseQuerySchema,
  rejectBodySchema,
  seekerBrowseQuerySchema,
  updateOfferBodySchema,
  updateSeekerProfileBodySchema,
} from './vet-job.schemas.js';

/**
 * `/vet-jobs/*` — Veterinarian Jobs / Careers. Every route is
 * authentication-only at the router level; role / ownership decisions live in
 * the services (any authenticated user may post a job offer; only an approved
 * veterinarian may create a seeker profile or apply; only the owner or a
 * VET_JOBS moderator manages a submission; application access is scoped to
 * the offer's poster and the applicant). Moderation lives under
 * `/admin/vet-job-*`.
 */
export function createVetJobRouter(c: Container): Router {
  const attachments = new VetJobAttachmentController(c.vetJobMedia);
  const offers = new VetJobOfferController(c.vetJobOfferService);
  const seekers = new VetJobSeekerProfileController(c.vetJobSeekerProfileService);
  const applications = new VetJobApplicationController(c.vetJobApplicationService);

  const r = Router();
  r.use(c.authenticate);

  // --- shared attachment upload -------------------------------------
  r.post(
    '/attachments/upload-url',
    validate({ body: attachmentUploadUrlBodySchema }),
    asyncHandler(attachments.uploadUrl),
  );

  // --- job offers ------------------------------------------------
  r.get('/offers', validate({ query: offerBrowseQuerySchema }), asyncHandler(offers.listPublic));
  r.post('/offers', validate({ body: createOfferBodySchema }), asyncHandler(offers.create));
  r.get('/offers/mine', validate({ query: mineQuerySchema }), asyncHandler(offers.listMine));
  r.get('/offers/:id', validate({ params: idParamSchema }), asyncHandler(offers.getPublic));
  r.get('/offers/:id/manage', validate({ params: idParamSchema }), asyncHandler(offers.getMine));
  r.patch(
    '/offers/:id',
    validate({ params: idParamSchema, body: updateOfferBodySchema }),
    asyncHandler(offers.update),
  );
  r.delete('/offers/:id', validate({ params: idParamSchema }), asyncHandler(offers.remove));
  r.post('/offers/:id/close', validate({ params: idParamSchema }), asyncHandler(offers.close));

  // applications on ONE offer (apply + the poster's own applicant queue)
  r.post(
    '/offers/:id/applications',
    validate({ params: idParamSchema, body: createApplicationBodySchema }),
    asyncHandler(applications.apply),
  );
  r.get(
    '/offers/:id/applications',
    validate({ params: idParamSchema, query: applicationListQuerySchema }),
    asyncHandler(applications.listForOffer),
  );

  // --- applications: across all offers + my own submissions ---------
  r.get(
    '/applications/received',
    validate({ query: applicationListQuerySchema }),
    asyncHandler(applications.listReceived),
  );
  r.get(
    '/applications/mine',
    validate({ query: applicationListQuerySchema }),
    asyncHandler(applications.listMine),
  );
  r.get('/applications/:id', validate({ params: idParamSchema }), asyncHandler(applications.getOne));
  r.post(
    '/applications/:id/accept',
    validate({ params: idParamSchema }),
    asyncHandler(applications.accept),
  );
  r.post(
    '/applications/:id/reject',
    validate({ params: idParamSchema }),
    asyncHandler(applications.reject),
  );

  // --- job-seeker profiles ("باحثون عن عمل") --------------------
  r.get('/seekers', validate({ query: seekerBrowseQuerySchema }), asyncHandler(seekers.listPublic));
  r.post(
    '/seekers',
    validate({ body: createSeekerProfileBodySchema }),
    asyncHandler(seekers.create),
  );
  r.get('/seekers/mine', asyncHandler(seekers.getMine));
  r.patch(
    '/seekers/mine',
    validate({ body: updateSeekerProfileBodySchema }),
    asyncHandler(seekers.update),
  );
  r.post('/seekers/mine/deactivate', asyncHandler(seekers.deactivate));
  r.get('/seekers/:id', validate({ params: idParamSchema }), asyncHandler(seekers.getPublic));
  r.post(
    '/seekers/:id/conversation',
    validate({ params: idParamSchema }),
    asyncHandler(applications.startConversationWithSeeker),
  );

  return r;
}

/** `/admin/vet-job-offers*` + `/admin/vet-job-seekers*` + `/admin/vet-job-applications` — moderation. */
export function createAdminVetJobRouter(c: Container): Router {
  const offers = new AdminVetJobOfferController(c.vetJobOfferService);
  const seekers = new AdminVetJobSeekerProfileController(c.vetJobSeekerProfileService);
  const applications = new AdminVetJobApplicationController(c.vetJobApplicationService);
  const { authorize } = c.authorization;
  const r = Router();
  r.use(c.authenticate);

  for (const [base, ctrl] of [
    ['/vet-job-offers', offers] as const,
    ['/vet-job-seekers', seekers] as const,
  ]) {
    r.get(base, authorize('vet_job.read'), validate({ query: moderationQuerySchema }), asyncHandler(ctrl.list));
    r.get(
      `${base}/:id`,
      authorize('vet_job.read'),
      validate({ params: idParamSchema }),
      asyncHandler(ctrl.getOne),
    );
    r.post(
      `${base}/:id/approve`,
      authorize('vet_job.approve'),
      validate({ params: idParamSchema }),
      asyncHandler(ctrl.approve),
    );
    r.post(
      `${base}/:id/reject`,
      authorize('vet_job.reject'),
      validate({ params: idParamSchema, body: rejectBodySchema }),
      asyncHandler(ctrl.reject),
    );
  }

  r.get(
    '/vet-job-applications',
    authorize('vet_job.read'),
    validate({ query: applicationListQuerySchema }),
    asyncHandler(applications.list),
  );

  return r;
}
