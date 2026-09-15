import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { OrganizationBroadcastService } from '../application/organization-broadcast.service.js';
import { requireOrganization } from './organization.middleware.js';
import type {
  OrganizationBroadcastImageUploadUrlBody,
  SendOrganizationBroadcastBody,
} from './organization-broadcast.schemas.js';

export class OrganizationBroadcastController {
  constructor(private readonly broadcasts: OrganizationBroadcastService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  requestImageUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<OrganizationBroadcastImageUploadUrlBody>(req);
    sendSuccess(res, await this.broadcasts.requestImageUploadUrl(org.id, body));
  };

  send = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<SendOrganizationBroadcastBody>(req);
    sendSuccess(
      res,
      await this.broadcasts.send(org.id, body, this.actor(req)),
      StatusCodes.CREATED,
    );
  };
}
