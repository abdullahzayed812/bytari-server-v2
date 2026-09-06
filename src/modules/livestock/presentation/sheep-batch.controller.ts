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
import type { SheepBatchService } from '../application/sheep-batch.service.js';
import { requireSheepBatch } from './sheep-batch.middleware.js';
import type {
  CreateSheepBatchBody,
  CreateSheepFarmBody,
  ListSheepBatchesQuery,
  UpdateSheepBatchBody,
} from './sheep-batch.schemas.js';

/** Sheep batch + farm-creation HTTP adapter. No business logic. */
export class SheepBatchController {
  constructor(
    private readonly batches: SheepBatchService,
    private readonly organizations: OrganizationService,
  ) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  /**
   * `POST /organizations/sheep-farms` — "Add Sheep Farm". Creates the FARM
   * organization + `farm_details` (species=SHEEP) + the caller's OWNER
   * membership in one transaction (via `OrganizationService.create`, the same
   * generic entry point `createPoultryFarm` uses); the org starts `PENDING`.
   */
  createFarm = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateSheepFarmBody>(req);
    const details: CreateOrganizationDetails = { farm_species: 'SHEEP' };
    if (body.location !== undefined) details.location = body.location;
    if (body.governorate !== undefined) details.governorate = body.governorate;
    if (body.sheepProductionType !== undefined) details.sheep_production_type = body.sheepProductionType;
    if (body.address != null) details.address = body.address;
    if (body.capacity != null) details.capacity = body.capacity;
    if (body.currentSheepCount != null) details.current_sheep_count = body.currentSheepCount;
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
    const body = validatedBody<CreateSheepBatchBody>(req);
    const dto = await this.batches.create({ id: org.id, type: org.type }, body, this.actor(req));
    sendSuccess(res, dto, StatusCodes.CREATED);
  };

  listBatches = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const q = validatedQuery<ListSheepBatchesQuery>(req);
    const { items, total } = await this.batches.list(org.id, {
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getBatch = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const batch = requireSheepBatch(req);
    sendSuccess(res, await this.batches.get(org.id, batch.id));
  };

  updateBatch = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const batch = requireSheepBatch(req);
    const body = validatedBody<UpdateSheepBatchBody>(req);
    sendSuccess(res, await this.batches.update(org.id, batch.id, body, this.actor(req)));
  };

  deleteBatch = async (req: Request, res: Response): Promise<void> => {
    const org = requireOrganization(req);
    const batch = requireSheepBatch(req);
    await this.batches.delete(org.id, batch.id, this.actor(req));
    sendSuccess(res, { deleted: true });
  };
}
