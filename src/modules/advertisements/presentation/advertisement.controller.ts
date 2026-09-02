import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest, type AuditContextResult } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { AdvertisementService } from '../application/advertisement.service.js';
import type {
  CreateCampaignBody,
  CreateSlideBody,
  ListAdminCampaignsQuery,
  ListPublicAdsQuery,
  RegisterImageBody,
  ReorderSlidesBody,
  UpdateCampaignBody,
  UpdateSlideBody,
  UploadUrlBody,
} from './advertisement.schemas.js';

type CampaignParams = { campaignId: string };
type SlideParams = { campaignId: string; slideId: string };

export class AdvertisementController {
  constructor(private readonly ads: AdvertisementService) {}

  private actor(req: Request): { actorUserId: string; context: AuditContextResult } {
    return { actorUserId: requireAuth(req).userId, context: auditContextFromRequest(req) };
  }

  // --- public / user ---------------------------------------

  listPublic = async (req: Request, res: Response): Promise<void> => {
    const { placement } = validatedQuery<ListPublicAdsQuery>(req);
    sendSuccess(res, await this.ads.listPublic(placement));
  };

  // --- admin / supervisor: campaigns ----------------------

  createCampaign = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateCampaignBody>(req);
    sendSuccess(res, await this.ads.createCampaign(this.actor(req), body), StatusCodes.CREATED);
  };

  listAdmin = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListAdminCampaignsQuery>(req);
    const { items, total } = await this.ads.listAdminCampaigns({
      page: q.page,
      pageSize: q.pageSize,
      placement: q.placement,
      type: q.type,
      includeDeleted: q.includeDeleted,
    });
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };

  getAdmin = async (req: Request, res: Response): Promise<void> => {
    const { campaignId } = validatedParams<CampaignParams>(req);
    sendSuccess(res, await this.ads.getAdminCampaign(campaignId));
  };

  updateCampaign = async (req: Request, res: Response): Promise<void> => {
    const { campaignId } = validatedParams<CampaignParams>(req);
    const body = validatedBody<UpdateCampaignBody>(req);
    sendSuccess(res, await this.ads.updateCampaign(this.actor(req), campaignId, body));
  };

  removeCampaign = async (req: Request, res: Response): Promise<void> => {
    const { campaignId } = validatedParams<CampaignParams>(req);
    sendSuccess(res, await this.ads.setCampaignDeleted(this.actor(req), campaignId, true));
  };

  restoreCampaign = async (req: Request, res: Response): Promise<void> => {
    const { campaignId } = validatedParams<CampaignParams>(req);
    sendSuccess(res, await this.ads.setCampaignDeleted(this.actor(req), campaignId, false));
  };

  activateCampaign = async (req: Request, res: Response): Promise<void> => {
    const { campaignId } = validatedParams<CampaignParams>(req);
    sendSuccess(res, await this.ads.setCampaignActive(this.actor(req), campaignId, true));
  };

  deactivateCampaign = async (req: Request, res: Response): Promise<void> => {
    const { campaignId } = validatedParams<CampaignParams>(req);
    sendSuccess(res, await this.ads.setCampaignActive(this.actor(req), campaignId, false));
  };

  // --- admin / supervisor: slides ------------------------

  addSlide = async (req: Request, res: Response): Promise<void> => {
    const { campaignId } = validatedParams<CampaignParams>(req);
    const body = validatedBody<CreateSlideBody>(req);
    sendSuccess(
      res,
      await this.ads.addSlide(this.actor(req), campaignId, body),
      StatusCodes.CREATED,
    );
  };

  updateSlide = async (req: Request, res: Response): Promise<void> => {
    const { campaignId, slideId } = validatedParams<SlideParams>(req);
    const body = validatedBody<UpdateSlideBody>(req);
    sendSuccess(res, await this.ads.updateSlide(this.actor(req), campaignId, slideId, body));
  };

  removeSlide = async (req: Request, res: Response): Promise<void> => {
    const { campaignId, slideId } = validatedParams<SlideParams>(req);
    await this.ads.deleteSlide(this.actor(req), campaignId, slideId);
    res.status(StatusCodes.NO_CONTENT).send();
  };

  reorderSlides = async (req: Request, res: Response): Promise<void> => {
    const { campaignId } = validatedParams<CampaignParams>(req);
    const { slideIds } = validatedBody<ReorderSlidesBody>(req);
    sendSuccess(res, await this.ads.reorderSlides(this.actor(req), campaignId, slideIds));
  };

  requestSlideUploadUrl = async (req: Request, res: Response): Promise<void> => {
    const { campaignId, slideId } = validatedParams<SlideParams>(req);
    const body = validatedBody<UploadUrlBody>(req);
    sendSuccess(
      res,
      await this.ads.requestSlideUploadUrl(campaignId, slideId, body),
      StatusCodes.CREATED,
    );
  };

  registerSlideImage = async (req: Request, res: Response): Promise<void> => {
    const { campaignId, slideId } = validatedParams<SlideParams>(req);
    const body = validatedBody<RegisterImageBody>(req);
    sendSuccess(
      res,
      await this.ads.registerSlideImage(this.actor(req), campaignId, slideId, body),
      StatusCodes.CREATED,
    );
  };
}
