import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { CONSULTATION_CONFIG, INQUIRY_CONFIG } from '../application/thread.config.js';
import { AiSettingsController } from './ai-settings.controller.js';
import { ThreadController } from './thread.controller.js';
import {
  createConsultationBodySchema,
  createInquiryBodySchema,
  listAdminThreadsQuerySchema,
  listMessagesQuerySchema,
  listThreadsQuerySchema,
  sendThreadMessageBodySchema,
  threadIdParamSchema,
  updateAiSettingsBodySchema,
} from './thread.schemas.js';

/**
 * Consultation / Inquiry routes. Shared shape; the two mounts differ only in
 * the create-body schema. Access is decided in `SupportThreadService`
 * (CREATOR = `created_by_user_id`; RESPONDER = ADMIN override or an ACTIVE
 * CONSULTATION / INQUIRY supervisor domain who is an approved vet). There is no
 * per-route global-permission gate for creator paths — like Phase 4 animals /
 * Phase 12 chat, creation is authentication + eligibility only.
 */
function threadRouter(
  c: Container,
  ctrl: ThreadController,
  createBodySchema: typeof createConsultationBodySchema | typeof createInquiryBodySchema,
): Router {
  const r = Router();
  r.use(c.authenticate);

  r.get('/', validate({ query: listThreadsQuerySchema }), asyncHandler(ctrl.listMine));
  r.post('/', validate({ body: createBodySchema }), asyncHandler(ctrl.create));
  r.get('/:threadId', validate({ params: threadIdParamSchema }), asyncHandler(ctrl.get));
  r.get(
    '/:threadId/messages',
    validate({ params: threadIdParamSchema, query: listMessagesQuerySchema }),
    asyncHandler(ctrl.listMessages),
  );
  r.post(
    '/:threadId/messages',
    validate({ params: threadIdParamSchema, body: sendThreadMessageBodySchema }),
    asyncHandler(ctrl.sendMessage),
  );
  r.post('/:threadId/close', validate({ params: threadIdParamSchema }), asyncHandler(ctrl.close));
  r.post('/:threadId/block', validate({ params: threadIdParamSchema }), asyncHandler(ctrl.block));
  r.post(
    '/:threadId/unblock',
    validate({ params: threadIdParamSchema }),
    asyncHandler(ctrl.unblock),
  );

  return r;
}

export function createConsultationRouter(c: Container): Router {
  return threadRouter(
    c,
    new ThreadController(c.consultationService, CONSULTATION_CONFIG),
    createConsultationBodySchema,
  );
}

export function createInquiryRouter(c: Container): Router {
  return threadRouter(
    c,
    new ThreadController(c.inquiryService, INQUIRY_CONFIG),
    createInquiryBodySchema,
  );
}

/** `/admin/consultations`, `/admin/inquiries`, `/admin/ai-settings`. */
export function createSupportAdminRouter(c: Container): Router {
  const { authorize } = c.authorization;
  const consultations = new ThreadController(c.consultationService, CONSULTATION_CONFIG);
  const inquiries = new ThreadController(c.inquiryService, INQUIRY_CONFIG);
  const ai = new AiSettingsController(c.aiSettingsService);

  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/consultations',
    authorize('consultation.admin.read'),
    validate({ query: listAdminThreadsQuerySchema }),
    asyncHandler(consultations.listAdmin),
  );
  r.get(
    '/consultations/:threadId',
    authorize('consultation.admin.read'),
    validate({ params: threadIdParamSchema }),
    asyncHandler(consultations.get),
  );
  r.get(
    '/inquiries',
    authorize('inquiry.admin.read'),
    validate({ query: listAdminThreadsQuerySchema }),
    asyncHandler(inquiries.listAdmin),
  );
  r.get(
    '/inquiries/:threadId',
    authorize('inquiry.admin.read'),
    validate({ params: threadIdParamSchema }),
    asyncHandler(inquiries.get),
  );

  r.get('/ai-settings', authorize('ai.settings.manage'), asyncHandler(ai.get));
  r.patch(
    '/ai-settings',
    authorize('ai.settings.manage'),
    validate({ body: updateAiSettingsBodySchema }),
    asyncHandler(ai.update),
  );

  return r;
}
