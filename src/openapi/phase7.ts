/**
 * OpenAPI fragments for Phase 7 (Animal lifecycle publications: Lost / Adoption /
 * Mating). Merged into the base document by `buildOpenApiDocument`.
 *
 * Animal identity/profile, ownership + transfer + history (Phase 4) and the
 * clinic↔animal relationship (Phase 5) are documented by those phases and are
 * unchanged here. Phase 7 covers the publication lifecycle and its listing
 * fields (each kind collects a different subset — a discriminated union on
 * `kind`), plus the viewer interaction actions:
 *
 *   owner → POST /animals/{animalId}/publications        (PENDING)
 *   ADMIN / ANIMAL system supervisor → approve | reject
 *   any authenticated user → GET /animal-publications    (APPROVED only)
 *   any authenticated user (not the owner) →
 *     POST /animal-publications/{id}/interactions         ("طلب" / "ابلاغ")
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
    403: 'Not permitted (not the animal owner / lacks animal.approve|animal.reject / own listing)',
    404: 'Not found, or not visible to the caller (non-owned animal, non-APPROVED publication)',
    409: 'Conflict (animal deactivated, publication already reviewed, open publication exists)',
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
const animalIdParam = { name: 'animalId', in: 'path', required: true, schema: uuid };
const publicationIdParam = { name: 'publicationId', in: 'path', required: true, schema: uuid };
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
];
const kindEnum = ['LOST', 'ADOPTION', 'MATING'];
const statusEnum = ['PENDING', 'APPROVED', 'REJECTED'];
const healthStatusEnum = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR'];
const vaccinationStatusEnum = ['COMPLETE', 'PARTIAL', 'NONE'];
const ageEstimateEnum = ['UNDER_1_YEAR', 'ONE_TO_3_YEARS', 'THREE_TO_7_YEARS', 'OVER_7_YEARS'];
const interactionTypeEnum = ['REQUEST', 'SIGHTING'];

const animalSummary = {
  type: 'object',
  properties: {
    id: uuid,
    name: { type: 'string' },
    species: { type: 'string' },
    breed: { type: 'string', nullable: true },
    sex: { type: 'string' },
    dateOfBirth: { type: 'string', format: 'date', nullable: true },
    color: { type: 'string', nullable: true },
    distinguishingFeatures: { type: 'string', nullable: true },
    ageEstimate: { type: 'string', enum: ageEstimateEnum, nullable: true },
    galleryUrls: { type: 'array', items: { type: 'string' } },
  },
};

/** Listing fields shared by both the owner/moderation view and the public view. */
const listingFields: Obj = {
  contactName: { type: 'string' },
  contactPhone: { type: 'string' },
  city: { type: 'string', nullable: true, description: 'ADOPTION / MATING only' },
  extraNotes: { type: 'string', nullable: true },
  healthStatus: {
    type: 'string',
    enum: healthStatusEnum,
    nullable: true,
    description: 'ADOPTION / MATING only — self-declared, not a verified medical record',
  },
  vaccinationStatus: {
    type: 'string',
    enum: vaccinationStatusEnum,
    nullable: true,
    description: 'ADOPTION / MATING only',
  },
  isSterilized: { type: 'boolean', nullable: true, description: 'ADOPTION only' },
  lostDate: { type: 'string', format: 'date', nullable: true, description: 'LOST only' },
  lostTime: { type: 'string', nullable: true, description: 'LOST only, HH:MM' },
  lostGovernorate: { type: 'string', nullable: true, description: 'LOST only' },
  lostDistrict: { type: 'string', nullable: true, description: 'LOST only' },
  lostLocationDetail: { type: 'string', nullable: true, description: 'LOST only' },
  healthNotes: { type: 'string', nullable: true, description: 'LOST only, freeform' },
};

const schemas: Obj = {
  AnimalPublication: {
    type: 'object',
    description: 'Full owner / moderation view of a Lost / Adoption / Mating publication.',
    properties: {
      id: uuid,
      animalId: uuid,
      kind: { type: 'string', enum: kindEnum },
      status: { type: 'string', enum: statusEnum },
      note: { type: 'string', nullable: true },
      createdByUserId: uuid,
      reviewedByUserId: { type: 'string', format: 'uuid', nullable: true },
      reviewedAt: { type: 'string', format: 'date-time', nullable: true },
      rejectionReason: { type: 'string', nullable: true },
      ...listingFields,
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  PublicAnimalPublication: {
    type: 'object',
    description:
      'Public-browse projection — APPROVED only. No publisher account identity, no moderation ' +
      'metadata. DOES include `contactName` / `contactPhone` — explicit, per-listing contact info ' +
      'the owner chose to publish, never the account phone.',
    properties: {
      id: uuid,
      kind: { type: 'string', enum: kindEnum },
      note: { type: 'string', nullable: true },
      publishedAt: { type: 'string', format: 'date-time' },
      ...listingFields,
      animal: animalSummary,
    },
  },
  CreateAnimalPublicationRequest: {
    description:
      'Owner-only. `status`, `reviewedBy`, `reviewedAt` etc. are server-controlled. The field set ' +
      'genuinely differs per `kind` (see each variant).',
    oneOf: [
      { $ref: '#/components/schemas/CreateLostPublicationRequest' },
      { $ref: '#/components/schemas/CreateAdoptionPublicationRequest' },
      { $ref: '#/components/schemas/CreateMatingPublicationRequest' },
    ],
    discriminator: { propertyName: 'kind' },
  },
  CreateLostPublicationRequest: {
    type: 'object',
    required: [
      'kind',
      'contactName',
      'contactPhone',
      'lostDate',
      'lostGovernorate',
      'lostDistrict',
    ],
    properties: {
      kind: { type: 'string', enum: ['LOST'] },
      note: { type: 'string', maxLength: 2000, description: 'معلومات إضافية قد تساعد في العثور' },
      contactName: { type: 'string' },
      contactPhone: { type: 'string' },
      lostDate: { type: 'string', format: 'date' },
      lostTime: { type: 'string', description: 'HH:MM' },
      lostGovernorate: { type: 'string' },
      lostDistrict: { type: 'string' },
      lostLocationDetail: { type: 'string', maxLength: 500 },
      healthNotes: { type: 'string', maxLength: 1000 },
    },
  },
  CreateAdoptionPublicationRequest: {
    type: 'object',
    required: [
      'kind',
      'note',
      'contactName',
      'contactPhone',
      'city',
      'healthStatus',
      'vaccinationStatus',
      'isSterilized',
    ],
    properties: {
      kind: { type: 'string', enum: ['ADOPTION'] },
      note: { type: 'string', minLength: 1, maxLength: 2000, description: 'وصف الحيوان' },
      extraNotes: { type: 'string', maxLength: 2000 },
      contactName: { type: 'string' },
      contactPhone: { type: 'string' },
      city: { type: 'string' },
      healthStatus: { type: 'string', enum: healthStatusEnum },
      vaccinationStatus: { type: 'string', enum: vaccinationStatusEnum },
      isSterilized: { type: 'boolean' },
    },
  },
  CreateMatingPublicationRequest: {
    type: 'object',
    required: ['kind', 'contactName', 'contactPhone', 'city', 'healthStatus', 'vaccinationStatus'],
    properties: {
      kind: { type: 'string', enum: ['MATING'] },
      note: { type: 'string', maxLength: 2000, description: 'وصف الحيوان' },
      extraNotes: { type: 'string', maxLength: 2000 },
      contactName: { type: 'string' },
      contactPhone: { type: 'string' },
      city: { type: 'string' },
      healthStatus: { type: 'string', enum: healthStatusEnum },
      vaccinationStatus: { type: 'string', enum: vaccinationStatusEnum },
    },
  },
  RejectAnimalPublicationRequest: {
    type: 'object',
    required: ['reason'],
    properties: { reason: { type: 'string', minLength: 1, maxLength: 1000 } },
  },
  PublicationInteraction: {
    type: 'object',
    properties: {
      id: uuid,
      publicationId: uuid,
      type: { type: 'string', enum: interactionTypeEnum },
      requesterUserId: uuid,
      message: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  CreatePublicationInteractionRequest: {
    type: 'object',
    required: ['type'],
    properties: {
      type: {
        type: 'string',
        enum: interactionTypeEnum,
        description: 'REQUEST = "طلب التبني"/"طلب تزاوج"; SIGHTING = "ابلاغ عن مشاهدة" (LOST only)',
      },
      message: { type: 'string', maxLength: 500 },
    },
  },
};

const paths: Obj = {
  '/animals/{animalId}/publications': {
    post: {
      tags: ['Animals · Publications'],
      summary: 'Publish an animal as Lost / for Adoption / for Mating (owner only)',
      description:
        'The caller must be the animal’s CURRENT owner (server-derived) and the animal must be ' +
        'ACTIVE. The publication starts PENDING and is not publicly visible until approved. ' +
        'Only one PENDING publication of a kind may exist per animal.',
      security: bearer,
      parameters: [animalIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateAnimalPublicationRequest' },
          },
        },
      },
      responses: {
        '201': ok('Created (PENDING)', dataOf({ $ref: '#/components/schemas/AnimalPublication' })),
        ...errs(401, 404, 409, 422),
      },
    },
    get: {
      tags: ['Animals · Publications'],
      summary: 'List an animal’s publications (owner / ADMIN / ANIMAL supervisor)',
      description: 'Shows every status. Non-owners without oversight get 404.',
      security: bearer,
      parameters: [animalIdParam, ...pageParams],
      responses: {
        '200': ok('Paginated publications', listOf('#/components/schemas/AnimalPublication')),
        ...errs(401, 404),
      },
    },
  },
  '/animals/{animalId}/publications/{publicationId}': {
    get: {
      tags: ['Animals · Publications'],
      summary: 'Get one of an animal’s publications (owner / ADMIN / ANIMAL supervisor)',
      security: bearer,
      parameters: [animalIdParam, publicationIdParam],
      responses: {
        '200': ok('Publication', dataOf({ $ref: '#/components/schemas/AnimalPublication' })),
        ...errs(401, 404),
      },
    },
  },

  '/animal-publications': {
    get: {
      tags: ['Animals · Publications'],
      summary: 'Browse APPROVED publications — every user’s listings, any authenticated user',
      description:
        'Only APPROVED publications. PENDING / REJECTED are never returned here, from any user — ' +
        'this is a global directory, not scoped to the caller. No owner account PII.',
      security: bearer,
      parameters: [
        ...pageParams,
        { name: 'kind', in: 'query', schema: { type: 'string', enum: kindEnum } },
        { name: 'species', in: 'query', schema: { type: 'string' } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        '200': ok(
          'Paginated approved publications',
          listOf('#/components/schemas/PublicAnimalPublication'),
        ),
        ...errs(401, 422),
      },
    },
  },
  '/animal-publications/{publicationId}': {
    get: {
      tags: ['Animals · Publications'],
      summary: 'Get one APPROVED publication (any authenticated user)',
      description: 'Returns 404 unless the publication is APPROVED — including for its own owner.',
      security: bearer,
      parameters: [publicationIdParam],
      responses: {
        '200': ok(
          'Approved publication',
          dataOf({ $ref: '#/components/schemas/PublicAnimalPublication' }),
        ),
        ...errs(401, 404),
      },
    },
  },
  '/animal-publications/{publicationId}/interactions': {
    post: {
      tags: ['Animals · Publications'],
      summary: '"طلب التبني" / "طلب تزاوج" / "ابلاغ عن مشاهدة" on an APPROVED listing',
      description:
        'Any authenticated user except the listing’s own owner. Fire-and-forget: notifies the ' +
        'owner via the Notifications module, no accept/reject workflow. Idempotent per ' +
        '(publication, requester, type) — re-submitting updates the message, not a duplicate.',
      security: bearer,
      parameters: [publicationIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreatePublicationInteractionRequest' },
          },
        },
      },
      responses: {
        '201': ok('Recorded', dataOf({ $ref: '#/components/schemas/PublicationInteraction' })),
        ...errs(401, 403, 404, 422),
      },
    },
  },

  '/admin/animal-publications': {
    get: {
      tags: ['Admin · Animal Publications'],
      summary: 'List publications for moderation (requires `animal.read`)',
      description:
        'Held by ADMIN (override) or an ACTIVE ANIMAL system-supervisor domain assignment. ' +
        'Filter by `kind` and `status` (typically `status=PENDING`).',
      security: bearer,
      parameters: [
        ...pageParams,
        { name: 'kind', in: 'query', schema: { type: 'string', enum: kindEnum } },
        { name: 'status', in: 'query', schema: { type: 'string', enum: statusEnum } },
      ],
      responses: {
        '200': ok('Paginated publications', listOf('#/components/schemas/AnimalPublication')),
        ...errs(401, 403),
      },
    },
  },
  '/admin/animal-publications/{publicationId}': {
    get: {
      tags: ['Admin · Animal Publications'],
      summary: 'Get any publication for moderation (requires `animal.read`)',
      security: bearer,
      parameters: [publicationIdParam],
      responses: {
        '200': ok('Publication', dataOf({ $ref: '#/components/schemas/AnimalPublication' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/animal-publications/{publicationId}/approve': {
    post: {
      tags: ['Admin · Animal Publications'],
      summary: 'Approve a PENDING publication (requires `animal.approve`)',
      description:
        'Only a PENDING publication can be approved (409 otherwise). Owners cannot self-approve. ' +
        'Approval is the ONLY way a listing becomes publicly visible.',
      security: bearer,
      parameters: [publicationIdParam],
      responses: {
        '200': ok('Approved', dataOf({ $ref: '#/components/schemas/AnimalPublication' })),
        ...errs(401, 403, 404, 409),
      },
    },
  },
  '/admin/animal-publications/{publicationId}/reject': {
    post: {
      tags: ['Admin · Animal Publications'],
      summary: 'Reject a PENDING publication (requires `animal.reject`)',
      security: bearer,
      parameters: [publicationIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/RejectAnimalPublicationRequest' },
          },
        },
      },
      responses: {
        '200': ok('Rejected', dataOf({ $ref: '#/components/schemas/AnimalPublication' })),
        ...errs(401, 403, 404, 409, 422),
      },
    },
  },
};

const tags = [
  {
    name: 'Animals · Publications',
    description: 'Lost / Adoption / Mating publications — owner create, browse APPROVED, interact',
  },
  {
    name: 'Admin · Animal Publications',
    description: 'Moderation queue — approve / reject (ADMIN or ANIMAL system supervisor)',
  },
];

export const phase7OpenApi = { tags, paths, schemas };
