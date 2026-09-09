/**
 * OpenAPI fragment — Veterinary Services marketplace ("الخدمات").
 *
 *  - `/vet-services/listings*`          vet-published service listings (moderated)
 *  - `/vet-services/requests*`          pet-owner service requests (moderated)
 *  - `/vet-services/requests/:id/offers`         a vet submits an offer (Flow B)
 *  - `/vet-services/listings/:id/requests`       an owner requests a listing (Flow A)
 *  - `/vet-services/offers|listing-requests/*`   accept / reject / complete / etc.
 *  - `/vet-services/{listings|requests}/:id/conversation`  "chat immediately"
 *  - `/admin/vet-service-{listings|requests}*`   moderation (vet_service.*)
 *
 * The deal chat itself is the shared `/conversations/*` API (type
 * `PET_OWNER_VETERINARIAN`), plus `POST /conversations/:id/close`.
 */
type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};
function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request',
    401: 'Missing or invalid access token',
    403: 'Not an approved veterinarian / lacks vet_service.* / not the owner',
    404: 'Not found, or the caller has no relationship to it',
    409: 'The listing / request / engagement is not in a state that allows this',
    422: 'Request failed validation',
  };
  const out: Obj = {};
  for (const c of codes) out[String(c)] = { description: map[c] ?? 'Error', content: jsonError };
  return out;
}
function ok(description: string, schema?: Obj): Obj {
  return schema ? { description, content: { 'application/json': { schema } } } : { description };
}
function dataOf(schema: Obj): Obj {
  return { type: 'object', properties: { data: schema } };
}
function listOf(ref: string): Obj {
  return {
    type: 'object',
    properties: { data: { type: 'array', items: { $ref: ref } }, meta: { type: 'object' } },
  };
}
const uuid = { type: 'string', format: 'uuid' };
const idParam = { name: 'id', in: 'path', required: true, schema: uuid };
const page = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
];

const MOD = ['PENDING', 'APPROVED', 'REJECTED'];
const ENG = ['PENDING', 'ACCEPTED', 'COMPLETED', 'REJECTED', 'CANCELLED'];

const schemas: Obj = {
  VetServiceUserSummary: {
    type: 'object',
    properties: { id: uuid, firstName: { type: 'string' }, lastName: { type: 'string' } },
  },
  VetServiceListing: {
    type: 'object',
    properties: {
      id: uuid,
      veterinarianUserId: uuid,
      veterinarian: { $ref: '#/components/schemas/VetServiceUserSummary' },
      title: { type: 'string' },
      description: { type: 'string' },
      serviceType: { type: 'string' },
      animalType: { type: 'string' },
      specialty: { type: 'string', nullable: true },
      governorate: { type: 'string' },
      district: { type: 'string', nullable: true },
      priceAmount: { type: 'string', nullable: true },
      priceType: { type: 'string', enum: ['FIXED', 'APPROXIMATE', 'NEGOTIABLE'] },
      locationMode: { type: 'string', enum: ['CLINIC', 'FIELD_VISIT', 'BOTH'] },
      availability: { type: 'string', nullable: true },
      contactPhone: { type: 'string', nullable: true },
      contactWhatsapp: { type: 'string', nullable: true },
      executionDuration: { type: 'string', nullable: true },
      arrivalTime: { type: 'string', nullable: true },
      details: { type: 'array', items: { type: 'string' } },
      imageUrls: { type: 'array', items: { type: 'string' } },
      status: { type: 'string', enum: MOD },
      rejectionReason: { type: 'string', nullable: true },
      closedAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  VetServiceRequest: {
    type: 'object',
    properties: {
      id: uuid,
      requestNumber: { type: 'string', example: 'REQ-2024-00125' },
      petOwnerUserId: uuid,
      petOwner: { $ref: '#/components/schemas/VetServiceUserSummary' },
      title: { type: 'string' },
      description: { type: 'string' },
      animalType: { type: 'string' },
      serviceType: { type: 'string' },
      animalCount: { type: 'integer', nullable: true },
      animalAge: { type: 'string', nullable: true },
      governorate: { type: 'string' },
      district: { type: 'string', nullable: true },
      detailedAddress: { type: 'string', nullable: true },
      needsFieldVisit: { type: 'boolean' },
      preferredDate: { type: 'string', nullable: true },
      budgetAmount: { type: 'string', nullable: true },
      urgency: { type: 'string', enum: ['NORMAL', 'URGENT'] },
      extraNotes: { type: 'string', nullable: true },
      imageUrls: { type: 'array', items: { type: 'string' } },
      status: { type: 'string', enum: MOD },
      rejectionReason: { type: 'string', nullable: true },
      offerCount: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  VetServiceOffer: {
    type: 'object',
    properties: {
      id: uuid,
      requestId: uuid,
      veterinarianUserId: uuid,
      veterinarian: { $ref: '#/components/schemas/VetServiceUserSummary' },
      proposedAmount: { type: 'string', nullable: true },
      executionDate: { type: 'string', nullable: true },
      expectedDuration: { type: 'string', nullable: true },
      includesFieldVisit: { type: 'boolean', nullable: true },
      details: { type: 'string', nullable: true },
      imageUrls: { type: 'array', items: { type: 'string' } },
      status: { type: 'string', enum: ENG },
      conversationId: { ...uuid, nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  VetServiceListingRequest: {
    type: 'object',
    properties: {
      id: uuid,
      requestNumber: { type: 'string' },
      listingId: uuid,
      petOwnerUserId: uuid,
      petOwner: { $ref: '#/components/schemas/VetServiceUserSummary' },
      animalType: { type: 'string' },
      animalCount: { type: 'integer', nullable: true },
      animalAge: { type: 'string', nullable: true },
      needsFieldVisit: { type: 'boolean' },
      preferredDatetime: { type: 'string', format: 'date-time', nullable: true },
      budgetAmount: { type: 'string', nullable: true },
      notes: { type: 'string', nullable: true },
      previousVisit: { type: 'boolean', nullable: true },
      imageUrls: { type: 'array', items: { type: 'string' } },
      status: { type: 'string', enum: ENG },
      conversationId: { ...uuid, nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  VetServiceConversationRef: {
    type: 'object',
    properties: { conversationId: uuid },
  },
};

const tags = [
  {
    name: 'Vet Services',
    description: 'Veterinary Services marketplace — listings, requests, offers, deal chats.',
  },
  {
    name: 'Vet Services · Admin',
    description: 'Moderation of service listings + pet-owner requests (vet_service.*).',
  },
];

const listingRef = '#/components/schemas/VetServiceListing';
const requestRef = '#/components/schemas/VetServiceRequest';
const offerRef = '#/components/schemas/VetServiceOffer';
const lrRef = '#/components/schemas/VetServiceListingRequest';

const paths: Obj = {
  '/vet-services/images/upload-url': {
    post: {
      tags: ['Vet Services'],
      summary: 'Presign an R2 upload for any vet-service image',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['filename', 'mimeType', 'size'],
              properties: {
                filename: { type: 'string' },
                mimeType: { type: 'string' },
                size: { type: 'integer' },
              },
            },
          },
        },
      },
      responses: { 201: ok('Presigned upload'), ...errs(400, 401, 422) },
    },
  },

  '/vet-services/listings': {
    get: {
      tags: ['Vet Services'],
      summary: 'Browse APPROVED service listings',
      security: bearer,
      parameters: [
        ...page,
        { name: 'search', in: 'query', schema: { type: 'string' } },
        { name: 'serviceType', in: 'query', schema: { type: 'string' } },
        { name: 'animalType', in: 'query', schema: { type: 'string' } },
        { name: 'governorate', in: 'query', schema: { type: 'string' } },
        { name: 'minPrice', in: 'query', schema: { type: 'number' } },
        { name: 'maxPrice', in: 'query', schema: { type: 'number' } },
      ],
      responses: { 200: ok('Listing page', listOf(listingRef)), ...errs(401, 422) },
    },
    post: {
      tags: ['Vet Services'],
      summary: 'Publish a service listing (APPROVED veterinarian only) — starts PENDING',
      security: bearer,
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: listingRef } } } },
      responses: { 201: ok('Created', dataOf({ $ref: listingRef })), ...errs(400, 401, 403, 422) },
    },
  },
  '/vet-services/listings/mine': {
    get: {
      tags: ['Vet Services'],
      summary: "The caller's own listings, every status",
      security: bearer,
      parameters: [...page, { name: 'status', in: 'query', schema: { type: 'string', enum: MOD } }],
      responses: { 200: ok('Listing page', listOf(listingRef)), ...errs(401, 422) },
    },
  },
  '/vet-services/listings/{id}': {
    parameters: [idParam],
    get: {
      tags: ['Vet Services'],
      summary: 'Get an APPROVED listing (public detail)',
      security: bearer,
      responses: { 200: ok('Listing', dataOf({ $ref: listingRef })), ...errs(401, 404) },
    },
    delete: {
      tags: ['Vet Services'],
      summary: 'Delete a listing (owner or VET_SERVICE moderator)',
      security: bearer,
      responses: { 200: ok('Deleted'), ...errs(401, 403, 404) },
    },
  },
  '/vet-services/listings/{id}/manage': {
    parameters: [idParam],
    get: {
      tags: ['Vet Services'],
      summary: 'Owner / moderator full view (moderation metadata)',
      security: bearer,
      responses: { 200: ok('Listing', dataOf({ $ref: listingRef })), ...errs(401, 404) },
    },
  },
  '/vet-services/listings/{id}/close': {
    parameters: [idParam],
    post: {
      tags: ['Vet Services'],
      summary: 'Close a listing (owner) — "منتهية"',
      security: bearer,
      responses: { 200: ok('Closed', dataOf({ $ref: listingRef })), ...errs(401, 403, 404) },
    },
  },
  '/vet-services/listings/{id}/requests': {
    parameters: [idParam],
    post: {
      tags: ['Vet Services'],
      summary: 'Request this listing ("طلب العرض") — Flow A',
      security: bearer,
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: lrRef } } } },
      responses: { 201: ok('Created', dataOf({ $ref: lrRef })), ...errs(401, 403, 409, 422) },
    },
    get: {
      tags: ['Vet Services'],
      summary: 'Requests received on this listing (listing vet only)',
      security: bearer,
      parameters: [...page, { name: 'status', in: 'query', schema: { type: 'string', enum: ENG } }],
      responses: { 200: ok('Page', listOf(lrRef)), ...errs(401, 404) },
    },
  },
  '/vet-services/listings/{id}/conversation': {
    parameters: [idParam],
    post: {
      tags: ['Vet Services'],
      summary: '"تواصل مع الطبيب" — open a deal chat with this listing\'s vet',
      security: bearer,
      responses: {
        201: ok('Conversation', dataOf({ $ref: '#/components/schemas/VetServiceConversationRef' })),
        ...errs(401, 403, 404, 409),
      },
    },
  },

  '/vet-services/requests': {
    get: {
      tags: ['Vet Services'],
      summary: 'Browse APPROVED pet-owner service requests',
      security: bearer,
      parameters: [
        ...page,
        { name: 'search', in: 'query', schema: { type: 'string' } },
        { name: 'serviceType', in: 'query', schema: { type: 'string' } },
        { name: 'animalType', in: 'query', schema: { type: 'string' } },
        { name: 'governorate', in: 'query', schema: { type: 'string' } },
        { name: 'urgency', in: 'query', schema: { type: 'string', enum: ['NORMAL', 'URGENT'] } },
        { name: 'sort', in: 'query', schema: { type: 'string', enum: ['recent', 'oldest'] } },
      ],
      responses: { 200: ok('Request page', listOf(requestRef)), ...errs(401, 422) },
    },
    post: {
      tags: ['Vet Services'],
      summary: 'Publish a service request (any authenticated user) — starts PENDING',
      security: bearer,
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: requestRef } } } },
      responses: { 201: ok('Created', dataOf({ $ref: requestRef })), ...errs(400, 401, 422) },
    },
  },
  '/vet-services/requests/mine': {
    get: {
      tags: ['Vet Services'],
      summary: "My requests (طلباتي), every status",
      security: bearer,
      parameters: [...page, { name: 'status', in: 'query', schema: { type: 'string', enum: MOD } }],
      responses: { 200: ok('Request page', listOf(requestRef)), ...errs(401, 422) },
    },
  },
  '/vet-services/requests/{id}': {
    parameters: [idParam],
    get: {
      tags: ['Vet Services'],
      summary: 'Request detail (owner / moderator / an approved vet browsing)',
      security: bearer,
      responses: { 200: ok('Request', dataOf({ $ref: requestRef })), ...errs(401, 404) },
    },
    delete: {
      tags: ['Vet Services'],
      summary: 'Delete a request (owner or moderator)',
      security: bearer,
      responses: { 200: ok('Deleted'), ...errs(401, 403, 404) },
    },
  },
  '/vet-services/requests/{id}/close': {
    parameters: [idParam],
    post: {
      tags: ['Vet Services'],
      summary: 'Close a request (owner)',
      security: bearer,
      responses: { 200: ok('Closed', dataOf({ $ref: requestRef })), ...errs(401, 403, 404) },
    },
  },
  '/vet-services/requests/{id}/offers': {
    parameters: [idParam],
    post: {
      tags: ['Vet Services'],
      summary: 'Submit an offer ("تقديم عرض") — APPROVED vet, not own request — Flow B',
      security: bearer,
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: offerRef } } } },
      responses: { 201: ok('Created', dataOf({ $ref: offerRef })), ...errs(401, 403, 409, 422) },
    },
    get: {
      tags: ['Vet Services'],
      summary: 'Offers on this request (request owner only)',
      security: bearer,
      parameters: [...page, { name: 'status', in: 'query', schema: { type: 'string', enum: ENG } }],
      responses: { 200: ok('Page', listOf(offerRef)), ...errs(401, 404) },
    },
  },
  '/vet-services/requests/{id}/conversation': {
    parameters: [idParam],
    post: {
      tags: ['Vet Services'],
      summary: '"تواصل مع صاحب الطلب" — a vet opens a deal chat with the request owner',
      security: bearer,
      responses: {
        201: ok('Conversation', dataOf({ $ref: '#/components/schemas/VetServiceConversationRef' })),
        ...errs(401, 403, 404, 409),
      },
    },
  },

  '/vet-services/offers/mine': {
    get: {
      tags: ['Vet Services'],
      summary: "My submitted offers",
      security: bearer,
      parameters: [...page, { name: 'status', in: 'query', schema: { type: 'string', enum: ENG } }],
      responses: { 200: ok('Page', listOf(offerRef)), ...errs(401, 422) },
    },
  },
  '/vet-services/offers/{id}': {
    parameters: [idParam],
    get: {
      tags: ['Vet Services'],
      summary: 'Offer detail (the vet or the request owner)',
      security: bearer,
      responses: { 200: ok('Offer', dataOf({ $ref: offerRef })), ...errs(401, 404) },
    },
  },
  ...['accept', 'reject', 'withdraw', 'complete'].reduce<Obj>((acc, verb) => {
    acc[`/vet-services/offers/{id}/${verb}`] = {
      parameters: [idParam],
      post: {
        tags: ['Vet Services'],
        summary:
          verb === 'accept'
            ? 'Request owner accepts an offer → a deal conversation opens; other offers auto-rejected'
            : verb === 'reject'
              ? 'Request owner rejects an offer'
              : verb === 'withdraw'
                ? 'The submitting vet withdraws their PENDING offer'
                : '"إنهاء الطلب" — either party completes an ACCEPTED offer',
        security: bearer,
        responses: { 200: ok('Updated', dataOf({ $ref: offerRef })), ...errs(401, 404, 409) },
      },
    };
    return acc;
  }, {}),

  '/vet-services/listing-requests/received': {
    get: {
      tags: ['Vet Services'],
      summary: 'Requests received across ALL of the caller\'s listings ("الموافقة على الخدمة")',
      security: bearer,
      parameters: [...page, { name: 'status', in: 'query', schema: { type: 'string', enum: ENG } }],
      responses: { 200: ok('Page', listOf(lrRef)), ...errs(401, 422) },
    },
  },
  '/vet-services/listing-requests/mine': {
    get: {
      tags: ['Vet Services'],
      summary: "The caller's own listing-requests",
      security: bearer,
      parameters: [...page, { name: 'status', in: 'query', schema: { type: 'string', enum: ENG } }],
      responses: { 200: ok('Page', listOf(lrRef)), ...errs(401, 422) },
    },
  },
  '/vet-services/listing-requests/{id}': {
    parameters: [idParam],
    get: {
      tags: ['Vet Services'],
      summary: 'Listing-request detail (the owner or the listing vet)',
      security: bearer,
      responses: { 200: ok('Request', dataOf({ $ref: lrRef })), ...errs(401, 404) },
    },
  },
  ...['accept', 'reject', 'cancel', 'complete'].reduce<Obj>((acc, verb) => {
    acc[`/vet-services/listing-requests/{id}/${verb}`] = {
      parameters: [idParam],
      post: {
        tags: ['Vet Services'],
        summary:
          verb === 'accept'
            ? 'The listing vet accepts → a deal conversation opens'
            : verb === 'reject'
              ? 'The listing vet rejects'
              : verb === 'cancel'
                ? 'The Pet Owner cancels their PENDING request'
                : '"إنهاء الطلب" — either party completes an ACCEPTED request',
        security: bearer,
        responses: { 200: ok('Updated', dataOf({ $ref: lrRef })), ...errs(401, 404, 409) },
      },
    };
    return acc;
  }, {}),

  '/conversations/{conversationId}/close': {
    parameters: [{ name: 'conversationId', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Vet Services'],
      summary: '"إيقاف المحادثة" — close a PET_OWNER_VETERINARIAN deal conversation',
      security: bearer,
      responses: { 200: ok('Closed'), ...errs(400, 401, 404) },
    },
  },

  ...['vet-service-listings', 'vet-service-requests'].reduce<Obj>((acc, base) => {
    const ref = base === 'vet-service-listings' ? listingRef : requestRef;
    acc[`/admin/${base}`] = {
      get: {
        tags: ['Vet Services · Admin'],
        summary: `Moderation queue (vet_service.read)`,
        security: bearer,
        parameters: [...page, { name: 'status', in: 'query', schema: { type: 'string', enum: MOD } }],
        responses: { 200: ok('Page', listOf(ref)), ...errs(401, 403, 422) },
      },
    };
    acc[`/admin/${base}/{id}`] = {
      parameters: [idParam],
      get: {
        tags: ['Vet Services · Admin'],
        summary: 'Any submission, full view (vet_service.read)',
        security: bearer,
        responses: { 200: ok('Item', dataOf({ $ref: ref })), ...errs(401, 403, 404) },
      },
    };
    acc[`/admin/${base}/{id}/approve`] = {
      parameters: [idParam],
      post: {
        tags: ['Vet Services · Admin'],
        summary: 'Approve (vet_service.approve)',
        security: bearer,
        responses: { 200: ok('Approved', dataOf({ $ref: ref })), ...errs(401, 403, 404, 409) },
      },
    };
    acc[`/admin/${base}/{id}/reject`] = {
      parameters: [idParam],
      post: {
        tags: ['Vet Services · Admin'],
        summary: 'Reject with a reason (vet_service.reject)',
        security: bearer,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } },
            },
          },
        },
        responses: { 200: ok('Rejected', dataOf({ $ref: ref })), ...errs(401, 403, 404, 409, 422) },
      },
    };
    return acc;
  }, {}),
};

export const vetServicesOpenApi = { tags, paths, schemas };
