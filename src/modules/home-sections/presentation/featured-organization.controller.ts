import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type {
  FeaturedActor,
  FeaturedOrganizationService,
} from '../application/featured-organization.service.js';
import type {
  AdminFeaturedListQuery,
  CreateFeaturedBody,
  FeaturedIdParams,
  FeaturedPlacementQuery,
  UpdateFeaturedBody,
} from './featured-organization.schemas.js';

export class FeaturedOrganizationController {
  constructor(private readonly featured: FeaturedOrganizationService) {}

  private actor(req: Request): FeaturedActor {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  /** Any signed-in user: today's carousel for one home page. */
  listVisible = async (req: Request, res: Response): Promise<void> => {
    const { placement } = validatedQuery<FeaturedPlacementQuery>(req);
    sendSuccess(res, await this.featured.listVisible(placement));
  };

  adminList = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<AdminFeaturedListQuery>(req);
    sendSuccess(res, await this.featured.listForAdmin({ placement: q.placement }));
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateFeaturedBody>(req);
    sendSuccess(res, await this.featured.create(body, this.actor(req)), StatusCodes.CREATED);
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<FeaturedIdParams>(req);
    const body = validatedBody<UpdateFeaturedBody>(req);
    sendSuccess(res, await this.featured.update(id, body, this.actor(req)));
  };

  remove = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<FeaturedIdParams>(req);
    await this.featured.remove(id, this.actor(req));
    sendSuccess(res, { removed: true });
  };
}
