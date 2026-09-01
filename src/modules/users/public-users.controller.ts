import type { Request, Response } from 'express';
import { NotFoundError } from '../../shared/errors/app-error.js';
import { sendSuccess } from '../../shared/http/response.js';
import { validatedParams } from '../../shared/http/validate.js';
import { toUserSummary } from './user.mapper.js';
import type { UserService } from './user.service.js';

/**
 * Read-only user directory for authenticated callers. Returns ONLY a name-level
 * summary (`{ id, firstName, lastName, veterinarianStatus }`) so the mobile app
 * can resolve the authorship / actor user ids that other DTOs already carry
 * (medical-record `recordedByUserId`, poultry / product `createdByUserId`,
 * publication `reviewedByUserId`, ownership `transferredBy`, …) and populate
 * member / supervisor pickers. No email, phone, account status, roles or
 * permissions are exposed here — that surface stays under `/admin/users`.
 */
export class PublicUsersController {
  constructor(private readonly users: UserService) {}

  get = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const user = await this.users.getByIdOrNull(id);
    // A DEACTIVATED account is treated as absent for directory lookups.
    if (!user || user.status === 'DEACTIVATED') throw new NotFoundError('User not found');
    sendSuccess(res, toUserSummary(user));
  };
}
