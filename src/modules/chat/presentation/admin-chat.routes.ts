import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { AdminChatController } from './admin-chat.controller.js';
import {
  adminConversationIdParamSchema,
  listAdminConversationMessagesQuerySchema,
  listAdminConversationsQuerySchema,
} from './admin-chat.schemas.js';

/**
 * Mounts `/admin/chat/conversations` — oversight read of every conversation
 * platform-wide, and a READ-ONLY viewer of any one of them (details +
 * chronological messages). `chat.read` (ADMIN) is enforced here on every
 * route; there is deliberately no admin write route.
 */
export function createAdminChatRouter(c: Container): Router {
  const ctrl = new AdminChatController(c.conversationRepository, c.chatService);
  const r = Router();

  r.use(c.authenticate);
  r.get(
    '/conversations',
    c.authorization.authorize('chat.read'),
    validate({ query: listAdminConversationsQuerySchema }),
    asyncHandler(ctrl.list),
  );
  r.get(
    '/conversations/:conversationId',
    c.authorization.authorize('chat.read'),
    validate({ params: adminConversationIdParamSchema }),
    asyncHandler(ctrl.get),
  );
  r.get(
    '/conversations/:conversationId/messages',
    c.authorization.authorize('chat.read'),
    validate({
      params: adminConversationIdParamSchema,
      query: listAdminConversationMessagesQuerySchema,
    }),
    asyncHandler(ctrl.messages),
  );

  return r;
}
