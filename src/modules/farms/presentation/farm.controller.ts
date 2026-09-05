import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type {
  CreateOrganizationDetails,
  OrganizationService,
} from '../../organizations/application/organization.service.js';
import type { FarmJoinService } from '../application/farm-join.service.js';
import type { CreateFarmBody, JoinFarmBody } from './farm.schemas.js';

/** Farm join-code + farm-creation HTTP adapter. No business logic. */
export class FarmController {
  constructor(
    private readonly join: FarmJoinService,
    private readonly organizations: OrganizationService,
  ) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  /**
   * `POST /organizations/farms` — "Add Poultry Farm". Creates the FARM
   * organization + `farm_details` + the caller's OWNER membership in one
   * transaction (via `OrganizationService.create`); the org starts `PENDING`.
   */
  createFarm = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateFarmBody>(req);
    const details: CreateOrganizationDetails = {};
    if (body.location !== undefined) details.location = body.location;
    if (body.governorate !== undefined) details.governorate = body.governorate;
    if (body.farmCategory !== undefined) details.farm_category = body.farmCategory;
    if (body.address != null) details.address = body.address;
    if (body.capacity != null) details.capacity = body.capacity;
    if (body.currentBirdCount != null) details.current_bird_count = body.currentBirdCount;
    if (body.contactName != null) details.contact_name = body.contactName;
    if (body.contactPhone != null) details.contact_phone = body.contactPhone;
    if (body.contactEmail != null) details.contact_email = body.contactEmail;

    const org = await this.organizations.create(
      {
        type: 'FARM',
        name: body.name,
        description: body.description ?? null,
        details,
      },
      this.actor(req),
    );
    sendSuccess(res, org, StatusCodes.CREATED);
  };

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
