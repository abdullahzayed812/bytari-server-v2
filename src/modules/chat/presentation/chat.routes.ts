import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { createOrganizationMiddleware } from '../../organizations/presentation/organization.middleware.js';
import { ChatController } from './chat.controller.js';
import { createChatMiddleware } from './chat.middleware.js';
import {
  conversationIdParamSchema,
  createConversationBodySchema,
  listConversationsQuerySchema,
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
  r.post(
    '/:conversationId/read',
    validate({ params: conversationIdParamSchema, body: markReadBodySchema }),
    withConversation,
    asyncHandler(ctrl.markRead),
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
