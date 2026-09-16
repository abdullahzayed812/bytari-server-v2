import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { ChatRoomService } from '../application/chat-room.service.js';
import type {
  CreateChatRoomBody,
  ListChatRoomMembersQuery,
  ListChatRoomsQuery,
  SetMutedBody,
  UpdateChatRoomRulesBody,
} from './chat-room.schemas.js';

/** `/chat-rooms/*` — Global Chat public discussion rooms. */
export class ChatRoomController {
  constructor(private readonly rooms: ChatRoomService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  list = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const q = validatedQuery<ListChatRoomsQuery>(req);
    const { items, total } = await this.rooms.listPublic(
      { page: q.page, pageSize: q.pageSize, search: q.search },
      userId,
    );
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    sendSuccess(res, await this.rooms.getOne(organizationId, userId));
  };

  listMembers = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    const q = validatedQuery<ListChatRoomMembersQuery>(req);
    const { items, total } = await this.rooms.listMembers(organizationId, userId, q.page, q.pageSize);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  join = async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    sendSuccess(res, await this.rooms.join(organizationId, this.actor(req)), StatusCodes.CREATED);
  };

  leave = async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    await this.rooms.leave(organizationId, this.actor(req));
    sendSuccess(res, { success: true });
  };

  setMuted = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    const body = validatedBody<SetMutedBody>(req);
    await this.rooms.setMuted(organizationId, userId, body.muted);
    sendSuccess(res, { success: true });
  };

  updateRules = async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    const body = validatedBody<UpdateChatRoomRulesBody>(req);
    await this.rooms.updateRules(organizationId, body.rules, this.actor(req));
    sendSuccess(res, { success: true });
  };

  pinMessage = async (req: Request, res: Response): Promise<void> => {
    const { organizationId, messageId } = validatedParams<{
      organizationId: string;
      messageId: string;
    }>(req);
    await this.rooms.pinMessage(organizationId, messageId, this.actor(req));
    sendSuccess(res, { success: true });
  };

  unpinMessage = async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = validatedParams<{ organizationId: string }>(req);
    await this.rooms.unpinMessage(organizationId, this.actor(req));
    sendSuccess(res, { success: true });
  };

  deleteMessage = async (req: Request, res: Response): Promise<void> => {
    const { organizationId, messageId } = validatedParams<{
      organizationId: string;
      messageId: string;
    }>(req);
    await this.rooms.deleteMessage(organizationId, messageId, this.actor(req));
    sendSuccess(res, { success: true });
  };
}

/** `/admin/chat-rooms` — create a room (`chat_room.admin.create`). */
export class AdminChatRoomController {
  constructor(private readonly rooms: ChatRoomService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const body = validatedBody<CreateChatRoomBody>(req);
    const room = await this.rooms.create(
      { name: body.name, description: body.description, rules: body.rules },
      { actorUserId: userId, context: auditContextFromRequest(req) },
    );
    sendSuccess(res, room, StatusCodes.CREATED);
  };
}
