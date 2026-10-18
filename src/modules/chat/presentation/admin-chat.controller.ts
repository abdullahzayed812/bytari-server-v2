import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { ChatService } from '../application/chat.service.js';
import type { ConversationRepository } from '../infrastructure/conversation.repository.js';
import type {
  ListAdminConversationMessagesQuery,
  ListAdminConversationsQuery,
} from './admin-chat.schemas.js';

export class AdminChatController {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly chat: ChatService,
  ) {}

  get = async (req: Request, res: Response): Promise<void> => {
    const { conversationId } = validatedParams<{ conversationId: string }>(req);
    sendSuccess(res, await this.chat.adminGetConversation(conversationId));
  };

  messages = async (req: Request, res: Response): Promise<void> => {
    const { conversationId } = validatedParams<{ conversationId: string }>(req);
    const q = validatedQuery<ListAdminConversationMessagesQuery>(req);
    const { items, total } = await this.chat.adminListMessages(
      { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) },
      conversationId,
      q.page,
      q.pageSize,
    );
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListAdminConversationsQuery>(req);
    const { items, total } = await this.conversations.listAllForAdmin({
      page: q.page,
      pageSize: q.pageSize,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
}
