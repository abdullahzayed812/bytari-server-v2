import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { ChatService } from '../application/chat.service.js';
import { requireConversation } from './chat.middleware.js';
import type {
  CreateConversationBody,
  ListConversationsQuery,
  ListMessagesQuery,
  MarkReadBody,
  SendMessageBody,
} from './chat.schemas.js';

/** Chat HTTP adapter. No business logic — every decision is in {@link ChatService}. */
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  /** POST /organizations/:organizationId/conversations */
  createConversation = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<CreateConversationBody>(req);
    const { conversation, created } = await this.chat.getOrCreateConversation(
      this.actor(req),
      { id: org.id, type: org.type, status: org.status, ownerUserId: org.ownerUserId },
      body.targetUserId ?? null,
    );
    sendSuccess(res, conversation, created ? StatusCodes.CREATED : StatusCodes.OK);
  };

  /** GET /conversations */
  listConversations = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const q = validatedQuery<ListConversationsQuery>(req);
    const { items, total } = await this.chat.listConversations(userId, {
      page: q.page,
      pageSize: q.pageSize,
      organizationId: q.organizationId,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  /** GET /conversations/:conversationId */
  getConversation = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const conversation = requireConversation(req);
    sendSuccess(res, await this.chat.getConversation(userId, conversation.id));
  };

  /** GET /conversations/:conversationId/messages */
  listMessages = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const conversation = requireConversation(req);
    const q = validatedQuery<ListMessagesQuery>(req);
    const { items, total } = await this.chat.listMessages(
      userId,
      conversation.id,
      q.page,
      q.pageSize,
    );
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  /** POST /conversations/:conversationId/messages */
  sendMessage = async (req: Request, res: Response): Promise<void> => {
    const conversation = requireConversation(req);
    const body = validatedBody<SendMessageBody>(req);
    const message = await this.chat.sendMessage(this.actor(req), conversation.id, body.body);
    sendSuccess(res, message, StatusCodes.CREATED);
  };

  /** POST /conversations/:conversationId/read */
  markRead = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const conversation = requireConversation(req);
    const body = validatedBody<MarkReadBody>(req);
    sendSuccess(res, await this.chat.markRead(userId, conversation.id, body.messageId));
  };

  /** DELETE /messages/:messageId */
  deleteMessage = async (req: Request, res: Response): Promise<void> => {
    const { messageId } = validatedParams<{ messageId: string }>(req);
    sendSuccess(res, await this.chat.deleteMessage(this.actor(req), messageId));
  };
}
