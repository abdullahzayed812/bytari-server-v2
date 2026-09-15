import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import { AdminChatController } from './admin-chat.controller.js';
import { listAdminConversationsQuerySchema } from './admin-chat.schemas.js';

/** Mounts `/admin/chat/conversations` — oversight read of every conversation platform-wide. */
export function createAdminChatRouter(c: Container): Router {
  const ctrl = new AdminChatController(c.conversationRepository);
  const r = Router();

  r.use(c.authenticate);
  r.get(
    '/conversations',
    c.authorization.authorize('chat.read'),
    validate({ query: listAdminConversationsQuerySchema }),
    asyncHandler(ctrl.list),
  );

  return r;
}
