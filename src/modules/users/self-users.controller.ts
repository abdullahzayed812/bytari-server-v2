import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { sendSuccess } from '../../shared/http/response.js';
import { validatedBody } from '../../shared/http/validate.js';
import { auditContextFromRequest } from '../audit/audit-context.js';
import { requireAuth } from '../auth/authenticate.middleware.js';
import type { UserService } from './user.service.js';
import type { AvatarUploadUrlBody, FinalizeAvatarBody } from './user.schemas.js';

/** `/users/me/*` — authenticated self-service (avatar upload). */
export class SelfUsersController {
  constructor(private readonly users: UserService) {}

  requestAvatarUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const body = validatedBody<AvatarUploadUrlBody>(req);
    const result = await this.users.requestAvatarUploadUrl(auth.userId, body);
    sendSuccess(res, result, StatusCodes.CREATED);
  };

  finalizeAvatar = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const body = validatedBody<FinalizeAvatarBody>(req);
    const user = await this.users.finalizeAvatar(
      auth.userId,
      { actorUserId: auth.userId, context: auditContextFromRequest(req) },
      body,
    );
    sendSuccess(res, user);
  };
}
