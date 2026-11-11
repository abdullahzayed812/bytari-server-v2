import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { sendSuccess } from '../../shared/http/response.js';
import { validatedBody } from '../../shared/http/validate.js';
import { auditContextFromRequest } from '../audit/audit-context.js';
import { requireAuth } from '../auth/authenticate.middleware.js';
import { BadRequestError } from '../../shared/errors/app-error.js';
import { ErrorCode } from '../../shared/errors/error-codes.js';
import type { PasswordService } from '../auth/password.service.js';
import type { UserBlockService } from './user-block.service.js';
import type { UserDeletionService } from './user-deletion.service.js';
import type { UserService } from './user.service.js';
import type {
  AvatarUploadUrlBody,
  DeleteMyAccountBody,
  FinalizeAvatarBody,
  UpdateMyProfileBody,
} from './user.schemas.js';

/** `/users/me/*` — authenticated self-service (avatar upload, own profile edit, account deletion). */
export class SelfUsersController {
  constructor(
    private readonly users: UserService,
    private readonly deletion: UserDeletionService,
    private readonly passwords: PasswordService,
    private readonly blocks: UserBlockService,
  ) {}

  listBlocks = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    sendSuccess(res, await this.blocks.list(auth.userId));
  };

  block = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    await this.blocks.block(auth.userId, String(req.params.userId));
    sendSuccess(res, { userId: String(req.params.userId), blocked: true });
  };

  unblock = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    await this.blocks.unblock(auth.userId, String(req.params.userId));
    sendSuccess(res, { userId: String(req.params.userId), blocked: false });
  };

  /**
   * `DELETE /users/me` — the signed-in user permanently deletes their own
   * account. Same engine (and the same retained/removed rules) as the admin
   * delete; organization owners and ADMIN accounts get 409
   * `USER_DELETE_BLOCKED` with `details[0].rule`. A wrong password is a 400
   * `INVALID_CURRENT_PASSWORD` (never 401 — the session itself is valid).
   */
  deleteMe = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const body = validatedBody<DeleteMyAccountBody>(req);
    const user = await this.users.getById(auth.userId);
    if (!(await this.passwords.verify(user.passwordHash, body.password))) {
      throw new BadRequestError('Password is incorrect', {
        code: ErrorCode.INVALID_CURRENT_PASSWORD,
        details: [{ path: 'body.password', message: 'incorrect' }],
      });
    }
    const result = await this.deletion.deleteUser(
      auth.userId,
      { actorUserId: auth.userId, context: auditContextFromRequest(req) },
      { selfService: true },
    );
    sendSuccess(res, { id: result.id, deleted: true });
  };

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

  updateMe = async (req: Request, res: Response): Promise<void> => {
    const auth = requireAuth(req);
    const body = validatedBody<UpdateMyProfileBody>(req);
    const user = await this.users.updateProfile(auth.userId, body, {
      actorUserId: auth.userId,
      context: auditContextFromRequest(req),
    });
    sendSuccess(res, await this.users.toPublicUserWithAvatar(user));
  };
}
