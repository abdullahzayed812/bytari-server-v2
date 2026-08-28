import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type { FarmJoinService } from '../application/farm-join.service.js';
import type { JoinFarmBody } from './farm.schemas.js';

/** Farm join-code HTTP adapter. No business logic. */
export class FarmController {
  constructor(private readonly join: FarmJoinService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  /** `POST /organizations/join` — a veterinarian joins a farm by its code. */
  joinByCode = async (req: Request, res: Response): Promise<void> => {
    const { joinCode } = validatedBody<JoinFarmBody>(req);
    const { membership, alreadyMember } = await this.join.joinByCode(joinCode, this.actor(req));
    sendSuccess(res, membership, alreadyMember ? StatusCodes.OK : StatusCodes.CREATED);
  };

  /** `GET /organizations/:organizationId/join-code` — read the current code. */
  getJoinCode = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    sendSuccess(res, await this.join.getJoinCode(org.id, { type: org.type }));
  };

  /** `POST /organizations/:organizationId/join-code/regenerate` — rotate the code. */
  regenerateJoinCode = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    sendSuccess(
      res,
      await this.join.regenerateJoinCode(org.id, { type: org.type }, this.actor(req)),
    );
  };
}
