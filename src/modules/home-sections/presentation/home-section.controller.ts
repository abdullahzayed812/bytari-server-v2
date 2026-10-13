import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { HomeSectionImageService } from '../application/home-section-image.service.js';
import type {
  HomeSectionKeyParams,
  HomeSectionRegisterImageBody,
  HomeSectionUploadUrlBody,
} from './home-section.schemas.js';

export class HomeSectionController {
  constructor(private readonly sections: HomeSectionImageService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  /** Public (any signed-in user) and admin: every section with its image or `null`. */
  list = async (_req: Request, res: Response): Promise<void> => {
    sendSuccess(res, await this.sections.list());
  };

  requestUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const { key } = validatedParams<HomeSectionKeyParams>(req);
    const body = validatedBody<HomeSectionUploadUrlBody>(req);
    sendSuccess(res, await this.sections.requestUploadUrl(key, body));
  };

  registerImage = async (req: Request, res: Response): Promise<void> => {
    const { key } = validatedParams<HomeSectionKeyParams>(req);
    const body = validatedBody<HomeSectionRegisterImageBody>(req);
    sendSuccess(res, await this.sections.registerImage(this.actor(req), key, body));
  };

  removeImage = async (req: Request, res: Response): Promise<void> => {
    const { key } = validatedParams<HomeSectionKeyParams>(req);
    sendSuccess(res, await this.sections.removeImage(this.actor(req), key));
  };
}
