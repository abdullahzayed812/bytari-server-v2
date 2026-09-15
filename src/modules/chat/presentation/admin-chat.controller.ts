import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedQuery } from '../../../shared/http/validate.js';
import type { ConversationRepository } from '../infrastructure/conversation.repository.js';
import type { ListAdminConversationsQuery } from './admin-chat.schemas.js';

export class AdminChatController {
  constructor(private readonly conversations: ConversationRepository) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListAdminConversationsQuery>(req);
    const { items, total } = await this.conversations.listAllForAdmin({
      page: q.page,
      pageSize: q.pageSize,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
}
