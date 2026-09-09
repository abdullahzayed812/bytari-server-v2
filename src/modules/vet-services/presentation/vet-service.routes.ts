import { Router } from 'express';
import { asyncHandler } from '../../../shared/http/async-handler.js';
import { validate } from '../../../shared/http/validate.js';
import type { Container } from '../../../container.js';
import {
  AdminVetServiceListingController,
  AdminVetServiceRequestController,
} from './admin-vet-service.controller.js';
import {
  VetServiceImageController,
  VetServiceListingController,
  VetServiceListingRequestController,
  VetServiceOfferController,
  VetServiceRequestController,
} from './vet-service.controllers.js';
import {
  createListingBodySchema,
  createListingRequestBodySchema,
  createOfferBodySchema,
  createRequestBodySchema,
  engagementListQuerySchema,
  idParamSchema,
  imageUploadUrlBodySchema,
  listingBrowseQuerySchema,
  mineQuerySchema,
  moderationQuerySchema,
  rejectBodySchema,
  requestBrowseQuerySchema,
} from './vet-service.schemas.js';

/**
 * `/vet-services/*` — the Veterinary Services marketplace. Every route is
 * authentication-only at the router level; role / ownership decisions live in
 * the services (only APPROVED vets add listings + offers; only the owner or a
 * VET_SERVICE moderator manages a submission; engagement access is scoped to
 * the two parties). Moderation lives under `/admin/vet-service-*`.
 */
export function createVetServiceRouter(c: Container): Router {
  const images = new VetServiceImageController(c.vetServiceMedia);
  const listings = new VetServiceListingController(c.vetServiceListingService);
  const requests = new VetServiceRequestController(c.vetServiceRequestService);
  const offers = new VetServiceOfferController(c.vetServiceOfferService);
  const listingRequests = new VetServiceListingRequestController(
    c.vetServiceListingRequestService,
  );

  const r = Router();
  r.use(c.authenticate);

  // --- shared image upload -------------------------------------
  r.post(
    '/images/upload-url',
    validate({ body: imageUploadUrlBodySchema }),
    asyncHandler(images.uploadUrl),
  );

  // --- listings (vet-published services) --------------------
  r.get(
    '/listings',
    validate({ query: listingBrowseQuerySchema }),
    asyncHandler(listings.listPublic),
  );
  r.post(
    '/listings',
    validate({ body: createListingBodySchema }),
    asyncHandler(listings.create),
  );
  r.get('/listings/mine', validate({ query: mineQuerySchema }), asyncHandler(listings.listMine));
  r.get(
    '/listings/:id',
    validate({ params: idParamSchema }),
    asyncHandler(listings.getPublic),
  );
  r.get(
    '/listings/:id/manage',
    validate({ params: idParamSchema }),
    asyncHandler(listings.getMine),
  );
  r.delete('/listings/:id', validate({ params: idParamSchema }), asyncHandler(listings.remove));
  r.post(
    '/listings/:id/close',
    validate({ params: idParamSchema }),
    asyncHandler(listings.close),
  );

  // listing-requests (a Pet Owner requests a listing) + direct chat
  r.post(
    '/listings/:id/requests',
    validate({ params: idParamSchema, body: createListingRequestBodySchema }),
    asyncHandler(listingRequests.create),
  );
  r.post(
    '/listings/:id/conversation',
    validate({ params: idParamSchema }),
    asyncHandler(listingRequests.startConversation),
  );
  r.get(
    '/listings/:id/requests',
    validate({ params: idParamSchema, query: engagementListQuerySchema }),
    asyncHandler(listingRequests.listForListing),
  );

  // --- requests (pet-owner-published requests) --------------
  r.get(
    '/requests',
    validate({ query: requestBrowseQuerySchema }),
    asyncHandler(requests.listPublic),
  );
  r.post(
    '/requests',
    validate({ body: createRequestBodySchema }),
    asyncHandler(requests.create),
  );
  r.get('/requests/mine', validate({ query: mineQuerySchema }), asyncHandler(requests.listMine));
  r.get('/requests/:id', validate({ params: idParamSchema }), asyncHandler(requests.getOne));
  r.delete('/requests/:id', validate({ params: idParamSchema }), asyncHandler(requests.remove));
  r.post(
    '/requests/:id/close',
    validate({ params: idParamSchema }),
    asyncHandler(requests.close),
  );

  // offers (a Vet submits an offer on a request) + direct chat
  r.post(
    '/requests/:id/offers',
    validate({ params: idParamSchema, body: createOfferBodySchema }),
    asyncHandler(offers.create),
  );
  r.post(
    '/requests/:id/conversation',
    validate({ params: idParamSchema }),
    asyncHandler(offers.startConversation),
  );
  r.get(
    '/requests/:id/offers',
    validate({ params: idParamSchema, query: engagementListQuerySchema }),
    asyncHandler(offers.listForRequest),
  );

  // --- offers: my submitted offers + responses ------------
  r.get(
    '/offers/mine',
    validate({ query: engagementListQuerySchema }),
    asyncHandler(offers.listMine),
  );
  r.get('/offers/:id', validate({ params: idParamSchema }), asyncHandler(offers.getOne));
  r.post('/offers/:id/accept', validate({ params: idParamSchema }), asyncHandler(offers.accept));
  r.post('/offers/:id/reject', validate({ params: idParamSchema }), asyncHandler(offers.reject));
  r.post(
    '/offers/:id/withdraw',
    validate({ params: idParamSchema }),
    asyncHandler(offers.withdraw),
  );
  r.post(
    '/offers/:id/complete',
    validate({ params: idParamSchema }),
    asyncHandler(offers.complete),
  );

  // --- listing-requests: vet queue + my requests + responses ---
  r.get(
    '/listing-requests/received',
    validate({ query: engagementListQuerySchema }),
    asyncHandler(listingRequests.listForVet),
  );
  r.get(
    '/listing-requests/mine',
    validate({ query: engagementListQuerySchema }),
    asyncHandler(listingRequests.listMine),
  );
  r.get(
    '/listing-requests/:id',
    validate({ params: idParamSchema }),
    asyncHandler(listingRequests.getOne),
  );
  r.post(
    '/listing-requests/:id/accept',
    validate({ params: idParamSchema }),
    asyncHandler(listingRequests.accept),
  );
  r.post(
    '/listing-requests/:id/reject',
    validate({ params: idParamSchema }),
    asyncHandler(listingRequests.reject),
  );
  r.post(
    '/listing-requests/:id/cancel',
    validate({ params: idParamSchema }),
    asyncHandler(listingRequests.cancel),
  );
  r.post(
    '/listing-requests/:id/complete',
    validate({ params: idParamSchema }),
    asyncHandler(listingRequests.complete),
  );

  return r;
}

/** `/admin/vet-service-listings*` + `/admin/vet-service-requests*` — moderation. */
export function createAdminVetServiceRouter(c: Container): Router {
  const listings = new AdminVetServiceListingController(c.vetServiceListingService);
  const requests = new AdminVetServiceRequestController(c.vetServiceRequestService);
  const { authorize } = c.authorization;
  const r = Router();
  r.use(c.authenticate);

  for (const [base, ctrl] of [
    ['/vet-service-listings', listings] as const,
    ['/vet-service-requests', requests] as const,
  ]) {
    r.get(
      base,
      authorize('vet_service.read'),
      validate({ query: moderationQuerySchema }),
      asyncHandler(ctrl.list),
    );
    r.get(
      `${base}/:id`,
      authorize('vet_service.read'),
      validate({ params: idParamSchema }),
      asyncHandler(ctrl.getOne),
    );
    r.post(
      `${base}/:id/approve`,
      authorize('vet_service.approve'),
      validate({ params: idParamSchema }),
      asyncHandler(ctrl.approve),
    );
    r.post(
      `${base}/:id/reject`,
      authorize('vet_service.reject'),
      validate({ params: idParamSchema, body: rejectBodySchema }),
      asyncHandler(ctrl.reject),
    );
  }

  return r;
}
