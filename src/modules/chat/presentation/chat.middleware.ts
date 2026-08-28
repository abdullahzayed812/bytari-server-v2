import type { Request, RequestHandler } from 'express';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validatedParams } from '../../../shared/http/validate.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { ChatService } from '../application/chat.service.js';
import type { ConversationRepository } from '../infrastructure/conversation.repository.js';

/** Narrow `req.conversation` inside a controller that runs after `withConversation`. */
export function requireConversation(req: Request): Express.ConversationContext {
  if (!req.conversation) throw new NotFoundError('Conversation not found');
  return req.conversation;
}

/**
 * Resolve `:conversationId` (trusted route param) and run the SAME
 * relationship check the service uses. A caller with no current relationship
 * to the conversation gets `404` — ids do not leak, and membership changes
 * take effect immediately (the check is live, not from a stored row).
 */
export function createChatMiddleware(deps: {
  conversations: ConversationRepository;
  chat: ChatService;
}): { withConversation: RequestHandler } {
  const withConversation: RequestHandler = asyncHandler(async (req, _res, next) => {
    const { userId } = requireAuth(req);
    const { conversationId } = validatedParams<{ conversationId: string }>(req);

    const conversation = await deps.conversations.findById(conversationId);
    if (!conversation) throw new NotFoundError('Conversation not found');

    const side = await deps.chat.assertAccess(userId, conversation);
    req.conversation = {
      id: conversation.id,
      type: conversation.type,
      organizationId: conversation.organizationId,
      viewerSide: side,
    };
    next();
  });

  return { withConversation };
}
