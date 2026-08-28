import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { SupportThreadService, ThreadActor } from '../application/support-thread.service.js';
import type { ThreadKindConfig } from '../application/thread.config.js';
import type { ThreadMessageDTO } from '../domain/thread.types.js';
import type {
  CreateConsultationBody,
  ListAdminThreadsQuery,
  ListMessagesQuery,
  ListThreadsQuery,
  SendThreadMessageBody,
} from './thread.schemas.js';

/** HTTP adapter for one support-thread kind. No business logic. */
export class ThreadController {
  constructor(
    private readonly service: SupportThreadService,
    private readonly cfg: ThreadKindConfig,
  ) {}

  private actor(req: Request): ThreadActor {
    return {
      principal: requireAuth(req),
      context: auditContextFromRequest(req),
    };
  }

  private mapMessage(m: ThreadMessageDTO): Record<string, unknown> {
    return {
      id: m.id,
      [this.cfg.parentIdField]: m.threadId,
      senderUserId: m.senderUserId,
      source: m.source,
      body: m.body,
      deletedAt: m.deletedAt,
      createdAt: m.createdAt,
    };
  }

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateConsultationBody>(req);
    const dto = await this.service.create(this.actor(req), {
      body: body.body,
      animalId: this.cfg.hasAnimal ? (body.animalId ?? null) : null,
    });
    sendSuccess(res, dto, StatusCodes.CREATED);
  };

  listMine = async (req: Request, res: Response): Promise<void> => {
    const { userId } = requireAuth(req);
    const q = validatedQuery<ListThreadsQuery>(req);
    const { items, total } = await this.service.listMine(userId, {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  listAdmin = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListAdminThreadsQuery>(req);
    const { items, total } = await this.service.listAdmin(requireAuth(req), {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      createdByUserId: q.createdBy,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  get = async (req: Request, res: Response): Promise<void> => {
    const { threadId } = validatedParams<{ threadId: string }>(req);
    sendSuccess(res, await this.service.get(requireAuth(req), threadId));
  };

  listMessages = async (req: Request, res: Response): Promise<void> => {
    const { threadId } = validatedParams<{ threadId: string }>(req);
    const q = validatedQuery<ListMessagesQuery>(req);
    const { items, total } = await this.service.listMessages(
      requireAuth(req),
      threadId,
      q.page,
      q.pageSize,
    );
    sendSuccess(
      res,
      items.map((m) => this.mapMessage(m)),
      StatusCodes.OK,
      pageMeta(q.page, q.pageSize, total),
    );
  };

  sendMessage = async (req: Request, res: Response): Promise<void> => {
    const { threadId } = validatedParams<{ threadId: string }>(req);
    const body = validatedBody<SendThreadMessageBody>(req);
    const message = await this.service.sendMessage(this.actor(req), threadId, body.body);
    sendSuccess(res, this.mapMessage(message), StatusCodes.CREATED);
  };

  close = async (req: Request, res: Response): Promise<void> => {
    const { threadId } = validatedParams<{ threadId: string }>(req);
    sendSuccess(res, await this.service.close(this.actor(req), threadId));
  };

  block = async (req: Request, res: Response): Promise<void> => {
    const { threadId } = validatedParams<{ threadId: string }>(req);
    sendSuccess(res, await this.service.setSenderBlocked(this.actor(req), threadId, true));
  };

  unblock = async (req: Request, res: Response): Promise<void> => {
    const { threadId } = validatedParams<{ threadId: string }>(req);
    sendSuccess(res, await this.service.setSenderBlocked(this.actor(req), threadId, false));
  };
}
