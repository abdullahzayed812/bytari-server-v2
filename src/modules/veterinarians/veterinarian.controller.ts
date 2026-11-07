import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../shared/http/pagination.js';
import { sendSuccess } from '../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../shared/http/validate.js';
import { auditContextFromRequest } from '../audit/audit-context.js';
import { requireAuth } from '../auth/authenticate.middleware.js';
import type { VeterinarianService } from './veterinarian.service.js';
import type {
  AdminDocumentKindParams,
  AdminReplaceDocumentBody,
  ApplyBody,
  DocumentUploadUrlBody,
  PendingQuery,
  RejectBody,
} from './veterinarian.schemas.js';

export class VeterinarianController {
  constructor(private readonly vets: VeterinarianService) {}

  private actor(req: Request): {
    actorUserId: string;
    context: ReturnType<typeof auditContextFromRequest>;
  } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  apply = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const body = validatedBody<ApplyBody>(req);
    const application = await this.vets.apply(
      auth.userId,
      {
        note: body.note,
        subType: body.subType,
        documents: body.documents,
        specialization: body.specialization,
      },
      auditContextFromRequest(req),
    );
    sendSuccess(res, application, StatusCodes.CREATED);
  };

  requestDocumentUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const body = validatedBody<DocumentUploadUrlBody>(req);
    const result = await this.vets.requestDocumentUploadUrl(auth.userId, body);
    sendSuccess(res, result, StatusCodes.CREATED);
  };

  myStatus = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    sendSuccess(res, await this.vets.getStatus(auth.userId));
  };

  myDocuments = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    sendSuccess(res, await this.vets.getMyDocuments(auth.userId));
  };

  listPending = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<PendingQuery>(req);
    const { items, total } = await this.vets.listPending(q.page, q.pageSize, q.search);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  approve = async (req: Request, res: Response): Promise<void> => {
    const { userId } = validatedParams<{ userId: string }>(req);
    const application = await this.vets.approve(userId, this.actor(req));
    sendSuccess(res, application);
  };

  reject = async (req: Request, res: Response): Promise<void> => {
    const { userId } = validatedParams<{ userId: string }>(req);
    const { reason } = validatedBody<RejectBody>(req);
    const application = await this.vets.reject(userId, reason, this.actor(req));
    sendSuccess(res, application);
  };

  /** Admin: presigned upload for a replacement identity document of `:userId`. */
  requestAdminDocumentUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const { userId } = validatedParams<{ userId: string }>(req);
    const body = validatedBody<DocumentUploadUrlBody>(req);
    sendSuccess(
      res,
      await this.vets.requestAdminDocumentUploadUrl(userId, body),
      StatusCodes.CREATED,
    );
  };

  /** Admin: swap the `:kind` document for the uploaded object; returns the new list. */
  replaceDocument = async (req: Request, res: Response): Promise<void> => {
    const { userId, kind } = validatedParams<AdminDocumentKindParams>(req);
    const body = validatedBody<AdminReplaceDocumentBody>(req);
    sendSuccess(res, await this.vets.replaceDocumentAsAdmin(userId, kind, body, this.actor(req)));
  };
}
