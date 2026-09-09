import type { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { pageMeta } from '../../../shared/http/pagination.js';
import { sendSuccess } from '../../../shared/http/response.js';
import { validatedBody, validatedParams, validatedQuery } from '../../../shared/http/validate.js';
import { auditContextFromRequest } from '../../audit/audit-context.js';
import { requireAuth } from '../../auth/authenticate.middleware.js';
import type { VetServiceListingService, VetServiceActor } from '../application/vet-service-listing.service.js';
import type { VetServiceListingRequestService } from '../application/vet-service-listing-request.service.js';
import type { VetServiceMedia } from '../application/vet-service-media.js';
import type { VetServiceOfferService } from '../application/vet-service-offer.service.js';
import type { VetServiceRequestService } from '../application/vet-service-request.service.js';
import type {
  CreateListingBody,
  CreateListingRequestBody,
  CreateOfferBody,
  CreateRequestBody,
  EngagementListQuery,
  ImageUploadUrlBody,
  ListingBrowseQuery,
  MineQuery,
  RequestBrowseQuery,
} from './vet-service.schemas.js';

function actor(req: Request): VetServiceActor {
  return { principal: requireAuth(req), context: auditContextFromRequest(req) };
}

/** POST /vet-services/images/upload-url — one presign for every vet-service image. */
export class VetServiceImageController {
  constructor(private readonly media: VetServiceMedia) {}
  uploadUrl = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<ImageUploadUrlBody>(req);
    sendSuccess(res, await this.media.presignUpload(body), StatusCodes.CREATED);
  };
}

export class VetServiceListingController {
  constructor(private readonly listings: VetServiceListingService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateListingBody>(req);
    sendSuccess(res, await this.listings.create(body, actor(req)), StatusCodes.CREATED);
  };
  listPublic = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<ListingBrowseQuery>(req);
    const { items, total } = await this.listings.listPublic(q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  listMine = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<MineQuery>(req);
    const { items, total } = await this.listings.listMine(requireAuth(req).userId, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getPublic = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.listings.getPublic(id));
  };
  getMine = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.listings.getForActor(id, actor(req)));
  };
  remove = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    await this.listings.remove(id, actor(req));
    sendSuccess(res, { ok: true });
  };
  close = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.listings.close(id, actor(req)));
  };
}

export class VetServiceRequestController {
  constructor(private readonly requests: VetServiceRequestService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    const body = validatedBody<CreateRequestBody>(req);
    sendSuccess(res, await this.requests.create(body, actor(req)), StatusCodes.CREATED);
  };
  listPublic = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<RequestBrowseQuery>(req);
    const { items, total } = await this.requests.listPublic(q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  listMine = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<MineQuery>(req);
    const { items, total } = await this.requests.listMine(requireAuth(req).userId, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getOne = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.requests.getForActor(id, actor(req)));
  };
  remove = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    await this.requests.remove(id, actor(req));
    sendSuccess(res, { ok: true });
  };
  close = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.requests.close(id, actor(req)));
  };
}

export class VetServiceOfferController {
  constructor(private readonly offers: VetServiceOfferService) {}

  /** POST /vet-services/requests/:id/offers — a vet submits an offer. */
  create = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<CreateOfferBody>(req);
    sendSuccess(res, await this.offers.create(id, body, actor(req)), StatusCodes.CREATED);
  };
  /** POST /vet-services/requests/:id/conversation — a vet opens a chat with the owner. */
  startConversation = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.offers.startConversation(id, actor(req)), StatusCodes.CREATED);
  };
  listForRequest = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const q = validatedQuery<EngagementListQuery>(req);
    const { items, total } = await this.offers.listForRequest(id, q, actor(req));
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  listMine = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<EngagementListQuery>(req);
    const { items, total } = await this.offers.listMine(requireAuth(req).userId, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getOne = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.offers.getForActor(id, actor(req)));
  };
  accept = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.offers.accept(id, actor(req)));
  };
  reject = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.offers.reject(id, actor(req)));
  };
  withdraw = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.offers.withdraw(id, actor(req)));
  };
  complete = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.offers.complete(id, actor(req)));
  };
}

export class VetServiceListingRequestController {
  constructor(private readonly listingRequests: VetServiceListingRequestService) {}

  /** POST /vet-services/listings/:id/requests — an owner requests a listing. */
  create = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<CreateListingRequestBody>(req);
    sendSuccess(res, await this.listingRequests.create(id, body, actor(req)), StatusCodes.CREATED);
  };
  /** POST /vet-services/listings/:id/conversation — an owner opens a chat with the vet. */
  startConversation = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(
      res,
      await this.listingRequests.startConversation(id, actor(req)),
      StatusCodes.CREATED,
    );
  };
  listForListing = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    const q = validatedQuery<EngagementListQuery>(req);
    const { items, total } = await this.listingRequests.listForListing(id, q, actor(req));
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  listForVet = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<EngagementListQuery>(req);
    const { items, total } = await this.listingRequests.listForVet(requireAuth(req).userId, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  listMine = async (req: Request, res: Response): Promise<void> => {
    const q = validatedQuery<EngagementListQuery>(req);
    const { items, total } = await this.listingRequests.listMine(requireAuth(req).userId, q);
    sendSuccess(res, items, StatusCodes.OK, pageMeta(q.page, q.pageSize, total));
  };
  getOne = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.listingRequests.getForActor(id, actor(req)));
  };
  accept = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.listingRequests.accept(id, actor(req)));
  };
  reject = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.listingRequests.reject(id, actor(req)));
  };
  cancel = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.listingRequests.cancel(id, actor(req)));
  };
  complete = async (req: Request, res: Response): Promise<void> => {
    const { id } = validatedParams<{ id: string }>(req);
    sendSuccess(res, await this.listingRequests.complete(id, actor(req)));
  };
}
