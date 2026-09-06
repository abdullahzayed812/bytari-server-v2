import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import { requireOrganization } from '../../organizations/presentation/organization.middleware.js';
import type {
  CreateOrganizationDetails,
  OrganizationService,
} from '../../organizations/application/organization.service.js';
import type { CattleBatchService } from '../application/cattle-batch.service.js';
import { requireCattleBatch } from './cattle-batch.middleware.js';
import type {
  CreateCattleBatchBody,
  CreateCattleFarmBody,
  ListCattleBatchesQuery,
  UpdateCattleBatchBody,
} from './cattle-batch.schemas.js';

/** Cattle batch + farm-creation HTTP adapter. No business logic. */
export class CattleBatchController {
  constructor(
    private readonly batches: CattleBatchService,
    private readonly organizations: OrganizationService,
  ) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  /**
   * `POST /organizations/cattle-farms` — "Add Cattle Farm". Creates the FARM
   * organization + `farm_details` (species=CATTLE) + the caller's OWNER
   * membership in one transaction (via `OrganizationService.create`, the same
   * generic entry point `createPoultryFarm` uses); the org starts `PENDING`.
   */
  createFarm = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateCattleFarmBody>(req);
    const details: CreateOrganizationDetails = { farm_species: 'CATTLE' };
    if (body.location !== undefined) details.location = body.location;
    if (body.governorate !== undefined) details.governorate = body.governorate;
    if (body.cattleProductionType !== undefined) details.cattle_production_type = body.cattleProductionType;
    if (body.address != null) details.address = body.address;
    if (body.capacity != null) details.capacity = body.capacity;
    if (body.currentCattleCount != null) details.current_cattle_count = body.currentCattleCount;
    if (body.contactName != null) details.contact_name = body.contactName;
    if (body.contactPhone != null) details.contact_phone = body.contactPhone;
    if (body.contactEmail != null) details.contact_email = body.contactEmail;

    const org = await this.organizations.create(
      { type: 'FARM', name: body.name, description: body.description ?? null, details },
      this.actor(req),
    );
    sendSuccess(res, org, StatusCodes.CREATED);
  };

  createBatch = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const body = validatedBody<CreateCattleBatchBody>(req);
    const dto = await this.batches.create({ id: org.id, type: org.type }, body, this.actor(req));
    sendSuccess(res, dto, StatusCodes.CREATED);
  };

  listBatches = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const q = validatedQuery<ListCattleBatchesQuery>(req);
    const { items, total } = await this.batches.list(org.id, {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getBatch = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const batch = requireCattleBatch(req);
    sendSuccess(res, await this.batches.get(org.id, batch.id));
  };

  updateBatch = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const batch = requireCattleBatch(req);
    const body = validatedBody<UpdateCattleBatchBody>(req);
    sendSuccess(res, await this.batches.update(org.id, batch.id, body, this.actor(req)));
  };

  deleteBatch = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const batch = requireCattleBatch(req);
    await this.batches.delete(org.id, batch.id, this.actor(req));
    sendSuccess(res, { deleted: true });
  };
}
