import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AnimalTransferRequestService } from '../application/animal-transfer-request.service.js';
import { requireAnimal } from './animal.middleware.js';
import type {
  CreateTransferRequestBody,
  ListTransferRequestsQuery,
  RejectTransferRequestBody,
} from './transfer-request.schemas.js';

/** Thin HTTP adapter for the request/acceptance ownership-transfer workflow. */
export class TransferRequestController {
  constructor(private readonly requests: AnimalTransferRequestService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  create = async (req: Request, res: Response): Promise<void> => {
    const animal = requireAnimal(req);
    const body = validatedBody<CreateTransferRequestBody>(req);
    const request = await this.requests.create(animal, body, this.actor(req));
    sendSuccess(res, request, StatusCodes.CREATED);
  };

  listSent = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const q = validatedQuery<ListTransferRequestsQuery>(req);
    const { items, total } = await this.requests.listSent(auth.userId, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  listReceived = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const q = validatedQuery<ListTransferRequestsQuery>(req);
    const { items, total } = await this.requests.listReceived(auth.userId, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getOne = async (req: Request, res: Response): Promise<void> => {
    const { requestId } = validatedParams<{ requestId: string }>(req);
    sendSuccess(res, await this.requests.getForActor(requestId, this.actor(req)));
  };

  accept = async (req: Request, res: Response): Promise<void> => {
    const { requestId } = validatedParams<{ requestId: string }>(req);
    sendSuccess(res, await this.requests.accept(requestId, this.actor(req)));
  };

  reject = async (req: Request, res: Response): Promise<void> => {
    const { requestId } = validatedParams<{ requestId: string }>(req);
    const body = validatedBody<RejectTransferRequestBody>(req);
    sendSuccess(res, await this.requests.reject(requestId, body.reason, this.actor(req)));
  };

  cancel = async (req: Request, res: Response): Promise<void> => {
    const { requestId } = validatedParams<{ requestId: string }>(req);
    sendSuccess(res, await this.requests.cancel(requestId, this.actor(req)));
  };
}
