import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from '../../organizations/presentation/organization.middleware.js';
import {
  AdminSyndicateController,
  SyndicateAnnouncementController,
  SyndicateController,
  SyndicateMediaController,
  SyndicateMemberController,
  SyndicateSubmissionController,
} from './syndicate.controllers.js';
import {
  announcementListQuerySchema,
  assignSyndicateAdminBodySchema,
  memberListQuerySchema,
  messageMembersBodySchema,
  membersBroadcastImageUploadUrlBodySchema,
  organizationAndUserParamSchema,
  createAnnouncementBodySchema,
  createSubmissionBodySchema,
  createSyndicateBodySchema,
  idParamSchema,
  mySubmissionListQuerySchema,
  organizationAndIdParamSchema,
  organizationIdParamSchema,
  respondSubmissionBodySchema,
  submissionListQuerySchema,
  syndicateBrowseQuerySchema,
  updateAnnouncementBodySchema,
  updateSyndicateProfileBodySchema,
  uploadUrlBodySchema,
} from './syndicate.schemas.js';

/**
 * `/syndicates/*` — Veterinary Syndicates / Unions. Read endpoints (browse
 * main syndicates, browse a main syndicate's branches, one syndicate's
 * profile, its announcements) are public to any authenticated user — a
 * syndicate is a public directory, not a member-only organization. Write
 * endpoints reuse the exact same organization-scoped middleware
 * (`withOrganization` + `authorizeOrg`) every other organization type uses —
 * `syndicate.profile.manage` / `syndicate.announcement.manage` /
 * `syndicate.submission.read` / `syndicate.submission.respond`, held by the
 * organization OWNER (the creating ADMIN) or an explicitly assigned
 * SUPERVISOR member, with the usual ADMIN override baked into
 * `AuthorizationService.canInOrganization`. Submitting a request/inquiry is
 * open to any authenticated user. Creating a syndicate itself is ADMIN-only
 * (`/admin/syndicates`, `syndicate.admin.create`) — see `createAdminSyndicateRouter`.
 */
export function createSyndicateRouter(c: Container): Router {
  const media = new SyndicateMediaController(c.syndicateMedia);
  const syndicates = new SyndicateController(c.syndicateService);
  const announcements = new SyndicateAnnouncementController(c.syndicateAnnouncementService);
  const submissions = new SyndicateSubmissionController(c.syndicateSubmissionService);
  const members = new SyndicateMemberController(c.syndicateMemberService);
  const { withOrganization, authorizeOrg } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });

  const r = Router();
  r.use(c.authenticate);

  // --- media -----------------------------------------------------
  r.post(
    '/media/upload-url',
    validate({ body: uploadUrlBodySchema }),
    asyncHandler(media.uploadUrl),
  );

  // The caller's own submissions, across every syndicate — mounted BEFORE
  // `/:organizationId` so "submissions" is never parsed as a uuid param
  // (same reasoning as `/organizations/discover` in the organizations router).
  r.get(
    '/submissions/mine',
    validate({ query: mySubmissionListQuerySchema }),
    asyncHandler(submissions.listMine),
  );
  r.get(
    '/submissions/mine/:id',
    validate({ params: idParamSchema }),
    asyncHandler(submissions.getOwn),
  );
  // Same reasoning — "announcements" must never be parsed as an organizationId.
  r.get(
    '/announcements/:id',
    validate({ params: idParamSchema }),
    asyncHandler(announcements.getOne),
  );

  // --- browse (public) ---------------------------------------------
  r.get('/', validate({ query: syndicateBrowseQuerySchema }), asyncHandler(syndicates.listMain));
  // pinned to the Veterinarian Home (before `/:organizationId`)
  r.get('/pinned', asyncHandler(syndicates.listPinned));
  r.get(
    '/:organizationId',
    validate({ params: organizationIdParamSchema }),
    asyncHandler(syndicates.getOne),
  );
  // "تثبيت النقابة" — per-user quick access on the Veterinarian Home. Any
  // approved veterinarian (or Admin); enforced in `SyndicateService`.
  r.put(
    '/:organizationId/pin',
    validate({
      params: organizationIdParamSchema,
      body: z.object({ pinned: z.boolean() }).strict(),
    }),
    asyncHandler(syndicates.setPin),
  );
  r.get(
    '/:organizationId/branches',
    validate({ params: organizationIdParamSchema, query: syndicateBrowseQuerySchema }),
    asyncHandler(syndicates.listBranches),
  );
  // "What can I do here?" — any authenticated user; the response itself is
  // the access check (mostly-false flags for a non-supervisor), not a gate.
  r.get(
    '/:organizationId/my-access',
    validate({ params: organizationIdParamSchema }),
    asyncHandler(syndicates.getMyAccess),
  );
  r.get(
    '/:organizationId/announcements',
    validate({ params: organizationIdParamSchema, query: announcementListQuerySchema }),
    asyncHandler(announcements.list),
  );

  // --- profile management (syndicate.profile.manage) ---------------
  r.patch(
    '/:organizationId/profile',
    validate({ params: organizationIdParamSchema, body: updateSyndicateProfileBodySchema }),
    withOrganization,
    authorizeOrg('syndicate.profile.manage'),
    asyncHandler(syndicates.updateProfile),
  );

  // --- announcement management (syndicate.announcement.manage) -----
  r.post(
    '/:organizationId/announcements',
    validate({ params: organizationIdParamSchema, body: createAnnouncementBodySchema }),
    withOrganization,
    authorizeOrg('syndicate.announcement.manage'),
    asyncHandler(announcements.create),
  );
  r.patch(
    '/:organizationId/announcements/:id',
    validate({ params: organizationAndIdParamSchema, body: updateAnnouncementBodySchema }),
    withOrganization,
    authorizeOrg('syndicate.announcement.manage'),
    asyncHandler(announcements.update),
  );
  r.delete(
    '/:organizationId/announcements/:id',
    validate({ params: organizationAndIdParamSchema }),
    withOrganization,
    authorizeOrg('syndicate.announcement.manage'),
    asyncHandler(announcements.remove),
  );

  // --- submissions: requests ("طلبات") + inquiries ("استفسارات") ---------
  // `withOrganization` only (no `authorizeOrg`) — any authenticated user may
  // submit, but the controller still needs `req.organization` resolved.
  r.post(
    '/:organizationId/submissions',
    validate({ params: organizationIdParamSchema, body: createSubmissionBodySchema }),
    withOrganization,
    asyncHandler(submissions.create),
  );
  r.get(
    '/:organizationId/submissions',
    validate({ params: organizationIdParamSchema, query: submissionListQuerySchema }),
    withOrganization,
    authorizeOrg('syndicate.submission.read'),
    asyncHandler(submissions.listForOrganization),
  );
  r.get(
    '/:organizationId/submissions/:id',
    validate({ params: organizationAndIdParamSchema }),
    withOrganization,
    authorizeOrg('syndicate.submission.read'),
    asyncHandler(submissions.getForOrganization),
  );
  r.post(
    '/:organizationId/submissions/:id/respond',
    validate({ params: organizationAndIdParamSchema, body: respondSubmissionBodySchema }),
    withOrganization,
    authorizeOrg('syndicate.submission.respond'),
    asyncHandler(submissions.respond),
  );
  r.post(
    '/:organizationId/submissions/:id/close',
    validate({ params: organizationAndIdParamSchema }),
    withOrganization,
    authorizeOrg('syndicate.submission.respond'),
    asyncHandler(submissions.close),
  );

  // --- registration ("التسجيل في النقابة") — any authenticated user ------
  r.post(
    '/:organizationId/registration',
    validate({ params: organizationIdParamSchema }),
    asyncHandler(members.register),
  );
  r.get(
    '/:organizationId/registration',
    validate({ params: organizationIdParamSchema }),
    asyncHandler(members.getMine),
  );
  r.delete(
    '/:organizationId/registration',
    validate({ params: organizationIdParamSchema }),
    asyncHandler(members.cancelMine),
  );

  // --- registered members (syndicate.member.*, org-scoped) --------------
  // `/members/broadcast` is mounted before `/members/:userId`.
  r.post(
    '/:organizationId/members/broadcast/image-upload-url',
    validate({
      params: organizationIdParamSchema,
      body: membersBroadcastImageUploadUrlBodySchema,
    }),
    withOrganization,
    authorizeOrg('syndicate.member.message'),
    asyncHandler(members.broadcastImageUploadUrl),
  );
  r.post(
    '/:organizationId/members/broadcast',
    validate({ params: organizationIdParamSchema, body: messageMembersBodySchema }),
    withOrganization,
    authorizeOrg('syndicate.member.message'),
    asyncHandler(members.messageAll),
  );
  r.get(
    '/:organizationId/members',
    validate({ params: organizationIdParamSchema, query: memberListQuerySchema }),
    withOrganization,
    authorizeOrg('syndicate.member.read'),
    asyncHandler(members.list),
  );
  r.get(
    '/:organizationId/members/:userId',
    validate({ params: organizationAndUserParamSchema }),
    withOrganization,
    authorizeOrg('syndicate.member.read'),
    asyncHandler(members.getOne),
  );
  r.delete(
    '/:organizationId/members/:userId',
    validate({ params: organizationAndUserParamSchema }),
    withOrganization,
    authorizeOrg('syndicate.member.manage'),
    asyncHandler(members.remove),
  );
  r.post(
    '/:organizationId/members/:userId/conversation',
    validate({ params: organizationAndUserParamSchema }),
    withOrganization,
    authorizeOrg('syndicate.member.message'),
    asyncHandler(members.openConversation),
  );

  // --- syndicate admins ("مسؤول النقابة") — a SUPERVISOR membership with the
  // full syndicate permission set; same guard as the generic supervisor flow.
  r.post(
    '/:organizationId/admins',
    validate({ params: organizationIdParamSchema, body: assignSyndicateAdminBodySchema }),
    withOrganization,
    authorizeOrg('supervisor.assign'),
    asyncHandler(members.assignAdmin),
  );

  return r;
}

/** `/admin/syndicates` — create a main or subordinate syndicate (`syndicate.admin.create`). */
export function createAdminSyndicateRouter(c: Container): Router {
  const ctrl = new AdminSyndicateController(c.syndicateService);
  const r = Router();
  r.use(c.authenticate);
  r.post(
    '/syndicates',
    c.authorization.authorize('syndicate.admin.create'),
    validate({ body: createSyndicateBodySchema }),
    asyncHandler(ctrl.create),
  );
  r.delete(
    '/syndicates/:organizationId',
    c.authorization.authorize('syndicate.admin.delete'),
    validate({ params: organizationIdParamSchema }),
    asyncHandler(ctrl.remove),
  );
  return r;
}
