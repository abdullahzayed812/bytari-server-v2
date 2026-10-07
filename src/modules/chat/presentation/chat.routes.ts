import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from '../../organizations/presentation/organization.middleware.js';
import { ChatController } from './chat.controller.js';
import { createChatMiddleware } from './chat.middleware.js';
import {
  clinicChatActiveBodySchema,
  attachmentUploadUrlBodySchema,
  conversationMessageParamSchema,
  conversationIdParamSchema,
  createConversationBodySchema,
  listConversationsQuerySchema,
  unreadSummaryQuerySchema,
  listMessagesQuerySchema,
  markReadBodySchema,
  messageIdParamSchema,
  organizationIdParamSchema,
  sendMessageBodySchema,
} from './chat.schemas.js';

/**
 * Chat routes.
 *
 *   authenticate → [withOrganization | withConversation (relationship check)] → service
 *
 * Access is RELATIONSHIP-scoped (participant / current membership), not a
 * global permission — every authenticated user may hold conversations, but only
 * for the relationships the spec allows. `withConversation` runs the same live
 * check the realtime subscription authorizer uses.
 */
export function createChatRouter(c: Container): Router {
  const ctrl = new ChatController(c.chatService);
  const { withConversation } = createChatMiddleware({
    conversations: c.conversationRepository,
    chat: c.chatService,
  });

  const r = Router();
  r.use(c.authenticate);

  r.get(
    '/',
    validate({ query: listConversationsQuerySchema }),
    asyncHandler(ctrl.listConversations),
  );
  r.get(
    '/unread-summary',
    validate({ query: unreadSummaryQuerySchema }),
    asyncHandler(ctrl.unreadSummary),
  );
  r.get(
    '/:conversationId',
    validate({ params: conversationIdParamSchema }),
    withConversation,
    asyncHandler(ctrl.getConversation),
  );
  r.get(
    '/:conversationId/messages',
    validate({ params: conversationIdParamSchema, query: listMessagesQuerySchema }),
    withConversation,
    asyncHandler(ctrl.listMessages),
  );
  r.post(
    '/:conversationId/messages',
    validate({ params: conversationIdParamSchema, body: sendMessageBodySchema }),
    withConversation,
    asyncHandler(ctrl.sendMessage),
  );
  // Chat media: presigned upload scoped to this conversation, then send the
  // message with `attachment`. Reading an attachment re-checks access.
  r.post(
    '/:conversationId/attachments/upload-url',
    validate({ params: conversationIdParamSchema, body: attachmentUploadUrlBodySchema }),
    withConversation,
    asyncHandler(ctrl.requestAttachmentUpload),
  );
  r.get(
    '/:conversationId/messages/:messageId/attachment',
    validate({ params: conversationMessageParamSchema }),
    withConversation,
    asyncHandler(ctrl.getAttachment),
  );
  r.post(
    '/:conversationId/read',
    validate({ params: conversationIdParamSchema, body: markReadBodySchema }),
    withConversation,
    asyncHandler(ctrl.markRead),
  );
  r.post(
    '/:conversationId/close',
    validate({ params: conversationIdParamSchema }),
    withConversation,
    asyncHandler(ctrl.closeConversation),
  );
  r.post(
    '/:conversationId/clinic-active',
    validate({ params: conversationIdParamSchema, body: clinicChatActiveBodySchema }),
    withConversation,
    asyncHandler(ctrl.setClinicChatActive),
  );

  return r;
}

/** `DELETE /messages/:messageId` — soft-delete your own message. */
export function createChatMessageRouter(c: Container): Router {
  const ctrl = new ChatController(c.chatService);
  const r = Router();
  r.use(c.authenticate);
  r.delete(
    '/:messageId',
    validate({ params: messageIdParamSchema }),
    asyncHandler(ctrl.deleteMessage),
  );
  return r;
}

/** `POST /organizations/:organizationId/conversations` — start (or fetch) a conversation. */
export function createOrgChatRouter(c: Container): Router {
  const ctrl = new ChatController(c.chatService);
  const { withOrganization } = createOrganizationMiddleware({
    organizations: c.organizationRepository,
    authz: c.authorizationService,
  });

  const r = Router();
  r.use(c.authenticate);
  r.post(
    '/:organizationId/conversations',
    validate({ params: organizationIdParamSchema, body: createConversationBodySchema }),
    withOrganization,
    asyncHandler(ctrl.createConversation),
  );
  return r;
}
