/**
 * OpenAPI fragments for Phase 4 (Animal Core + Animal Ownership). Merged into
 * the base document by `buildOpenApiDocument`.
 *
 * Access to an individual animal is OWNERSHIP-scoped: the current owner (the one
 * open row in `animal_ownerships`) or an ADMIN. Cross-user access is hidden as
 * `404` rather than `403`. The initial owner is always the creator — the client
 * cannot choose it — and ownership only ever moves once a transfer request is accepted by its recipient.
 */

type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request (e.g. transfer target is not an active user)',
    401: 'Missing or invalid access token',
    403: 'Authenticated but not permitted',
    404: 'Animal not found, or not visible to the caller',
    409: 'Conflict with current state (animal deactivated, target already the owner, concurrent transfer)',
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

const animalIdParam = {
  name: 'animalId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

const speciesEnum = ['DOG', 'CAT', 'BIRD', 'RABBIT', 'REPTILE', 'FISH', 'HORSE', 'OTHER'];
const sexEnum = ['MALE', 'FEMALE', 'UNKNOWN'];
const statusEnum = ['ACTIVE', 'DEACTIVATED'];
const ageEstimateEnum = ['UNDER_1_YEAR', 'ONE_TO_3_YEARS', 'THREE_TO_7_YEARS', 'OVER_7_YEARS'];

const schemas: Obj = {
  Animal: {
    type: 'object',
    description: 'Client-safe animal. The current owner is resolved from the ownership history.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      species: { type: 'string', enum: speciesEnum },
      breed: { type: 'string', nullable: true },
      sex: { type: 'string', enum: sexEnum },
      dateOfBirth: { type: 'string', format: 'date', nullable: true },
      notes: { type: 'string', nullable: true },
      status: { type: 'string', enum: statusEnum },
      createdBy: { type: 'string', format: 'uuid' },
      currentOwnerUserId: { type: 'string', format: 'uuid', nullable: true },
      color: { type: 'string', nullable: true },
      distinguishingFeatures: { type: 'string', nullable: true },
      ageEstimate: {
        type: 'string',
        enum: ageEstimateEnum,
        nullable: true,
        description: 'For when the exact dateOfBirth is unknown',
      },
      galleryUrls: { type: 'array', items: { type: 'string' }, description: 'Resolved photo URLs' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  OwnershipRecord: {
    type: 'object',
    description: 'One interval in an animal’s ownership history. Append-only.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      animalId: { type: 'string', format: 'uuid' },
      ownerUserId: { type: 'string', format: 'uuid' },
      owner: {
        type: 'object',
        nullable: true,
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
        },
      },
      startedAt: { type: 'string', format: 'date-time' },
      endedAt: { type: 'string', format: 'date-time', nullable: true },
      isCurrent: { type: 'boolean' },
      transferredBy: { type: 'string', format: 'uuid', nullable: true },
      transferReason: { type: 'string', nullable: true },
    },
  },
  CreateAnimalRequest: {
    type: 'object',
    required: ['name', 'species'],
    description:
      'Owner-selecting and system fields (ownerId, ownershipId, status, createdBy, …) are ignored if supplied.',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 120 },
      species: { type: 'string', enum: speciesEnum },
      breed: { type: 'string', minLength: 1, maxLength: 120 },
      sex: { type: 'string', enum: sexEnum },
      dateOfBirth: {
        type: 'string',
        format: 'date',
        description: 'YYYY-MM-DD; not in the future',
      },
      notes: { type: 'string', maxLength: 2000 },
      color: { type: 'string', minLength: 1, maxLength: 80 },
      distinguishingFeatures: { type: 'string', minLength: 1, maxLength: 500 },
      ageEstimate: { type: 'string', enum: ageEstimateEnum },
    },
  },
  UpdateAnimalRequest: {
    type: 'object',
    minProperties: 1,
    description:
      'Profile fields only. Ownership and status are never changed through this endpoint.',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 120 },
      species: { type: 'string', enum: speciesEnum },
      breed: { type: 'string', minLength: 1, maxLength: 120, nullable: true },
      sex: { type: 'string', enum: sexEnum },
      dateOfBirth: { type: 'string', format: 'date', nullable: true },
      notes: { type: 'string', maxLength: 2000, nullable: true },
      color: { type: 'string', minLength: 1, maxLength: 80, nullable: true },
      distinguishingFeatures: { type: 'string', minLength: 1, maxLength: 500, nullable: true },
      ageEstimate: { type: 'string', enum: ageEstimateEnum, nullable: true },
    },
  },
  CreateTransferRequestRequest: {
    type: 'object',
    required: ['toUserId'],
    description:
      'The current owner (from the server, never the request body) proposes a transfer. `toUserId` ' +
      'must be an existing active user who is not already the current owner. Ownership does not move ' +
      'until the recipient accepts.',
    properties: {
      toUserId: { type: 'string', format: 'uuid' },
      reason: { type: 'string', maxLength: 500 },
    },
  },
  RejectTransferRequestRequest: {
    type: 'object',
    properties: {
      reason: { type: 'string', maxLength: 500 },
    },
  },
  AnimalTransferRequest: {
    type: 'object',
    description:
      'A proposed ownership transfer awaiting the recipient’s response. Accepting it performs the ' +
      'actual ownership transfer (a new `OwnershipRecord` interval); rejecting/cancelling never does.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      animal: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          species: { type: 'string', enum: speciesEnum },
          breed: { type: 'string', nullable: true },
        },
      },
      fromUser: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
        },
      },
      toUser: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
        },
      },
      status: { type: 'string', enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'] },
      reason: { type: 'string', nullable: true },
      responseReason: { type: 'string', nullable: true },
      respondedAt: { type: 'string', format: 'date-time', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
};

const paths: Obj = {
  '/animals': {
    post: {
      tags: ['Animals'],
      summary: 'Create an animal (the authenticated caller becomes the owner)',
      description:
        'Any authenticated, active user may create an animal. No admin approval. An initial ' +
        '`animal_ownerships` row for the caller is created in the same transaction.',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/CreateAnimalRequest' } },
        },
      },
      responses: {
        '201': ok('Created', dataOf({ $ref: '#/components/schemas/Animal' })),
        ...errs(401, 403, 422),
      },
    },
    get: {
      tags: ['Animals'],
      summary: 'List animals the caller currently owns',
      description: 'Owner-scoped. Never returns animals owned by other users (ADMIN included).',
      security: bearer,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        { name: 'status', in: 'query', schema: { type: 'string', enum: statusEnum } },
        { name: 'species', in: 'query', schema: { type: 'string', enum: speciesEnum } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        '200': ok('Paginated animals', {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/Animal' } },
            meta: { type: 'object' },
          },
        }),
        ...errs(401, 422),
      },
    },
  },
  '/animals/{animalId}': {
    get: {
      tags: ['Animals'],
      summary: 'Get one animal (current owner or ADMIN)',
      security: bearer,
      parameters: [animalIdParam],
      responses: {
        '200': ok('Animal', dataOf({ $ref: '#/components/schemas/Animal' })),
        ...errs(401, 404),
      },
    },
    patch: {
      tags: ['Animals'],
      summary: 'Update an animal’s profile (current owner or ADMIN)',
      description: 'The animal must be ACTIVE. Ownership and status are not affected.',
      security: bearer,
      parameters: [animalIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/UpdateAnimalRequest' } },
        },
      },
      responses: {
        '200': ok('Updated', dataOf({ $ref: '#/components/schemas/Animal' })),
        ...errs(401, 404, 409, 422),
      },
    },
    delete: {
      tags: ['Animals'],
      summary: 'Deactivate an animal (current owner or ADMIN)',
      description:
        'Soft delete: sets `status=DEACTIVATED`. Idempotent. Ownership history is preserved.',
      security: bearer,
      parameters: [animalIdParam],
      responses: {
        '200': ok('Deactivated', dataOf({ $ref: '#/components/schemas/Animal' })),
        ...errs(401, 404),
      },
    },
  },
  '/animals/{animalId}/transfer-requests': {
    post: {
      tags: ['Animals · Ownership'],
      summary: 'Propose an ownership transfer to another user (current owner or ADMIN)',
      description:
        'Starts PENDING. Ownership does not move until the recipient calls the `accept` action below. ' +
        'At most one open (PENDING) request per animal.',
      security: bearer,
      parameters: [animalIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateTransferRequestRequest' },
          },
        },
      },
      responses: {
        '201': ok(
          'Transfer request created (PENDING)',
          dataOf({ $ref: '#/components/schemas/AnimalTransferRequest' }),
        ),
        ...errs(400, 401, 404, 409, 422),
      },
    },
  },
  '/animal-transfer-requests/sent': {
    get: {
      tags: ['Animals · Ownership'],
      summary: 'Transfer requests I created, paginated',
      security: bearer,
      responses: {
        '200': ok(
          'Sent transfer requests',
          dataOf({ type: 'array', items: { $ref: '#/components/schemas/AnimalTransferRequest' } }),
        ),
        ...errs(401),
      },
    },
  },
  '/animal-transfer-requests/received': {
    get: {
      tags: ['Animals · Ownership'],
      summary: 'Transfer requests proposing me as the new owner, paginated',
      security: bearer,
      responses: {
        '200': ok(
          'Received transfer requests',
          dataOf({ type: 'array', items: { $ref: '#/components/schemas/AnimalTransferRequest' } }),
        ),
        ...errs(401),
      },
    },
  },
  '/animal-transfer-requests/{requestId}': {
    get: {
      tags: ['Animals · Ownership'],
      summary: 'One transfer request (sender or recipient only — 404 otherwise)',
      security: bearer,
      parameters: [
        {
          name: 'requestId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': ok(
          'Transfer request',
          dataOf({ $ref: '#/components/schemas/AnimalTransferRequest' }),
        ),
        ...errs(401, 404),
      },
    },
  },
  '/animal-transfer-requests/{requestId}/accept': {
    post: {
      tags: ['Animals · Ownership'],
      summary: 'Accept a transfer request (recipient only) — ownership actually moves',
      description:
        'Atomically resolves the request to ACCEPTED and performs the same ownership transfer as the ' +
        'legacy instant-transfer flow (new `OwnershipRecord` interval, `ANIMAL_OWNERSHIP_TRANSFERRED` audit).',
      security: bearer,
      parameters: [
        {
          name: 'requestId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': ok(
          'Request accepted; ownership transferred',
          dataOf({ $ref: '#/components/schemas/AnimalTransferRequest' }),
        ),
        ...errs(401, 403, 404, 409),
      },
    },
  },
  '/animal-transfer-requests/{requestId}/reject': {
    post: {
      tags: ['Animals · Ownership'],
      summary: 'Reject a transfer request (recipient only) — ownership is not touched',
      security: bearer,
      parameters: [
        {
          name: 'requestId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/RejectTransferRequestRequest' },
          },
        },
      },
      responses: {
        '200': ok(
          'Request rejected',
          dataOf({ $ref: '#/components/schemas/AnimalTransferRequest' }),
        ),
        ...errs(401, 403, 404, 409),
      },
    },
  },
  '/animal-transfer-requests/{requestId}/cancel': {
    post: {
      tags: ['Animals · Ownership'],
      summary: 'Cancel a transfer request (sender only)',
      security: bearer,
      parameters: [
        {
          name: 'requestId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': ok(
          'Request cancelled',
          dataOf({ $ref: '#/components/schemas/AnimalTransferRequest' }),
        ),
        ...errs(401, 403, 404, 409),
      },
    },
  },
  '/animals/{animalId}/ownership/history': {
    get: {
      tags: ['Animals · Ownership'],
      summary: 'Full ownership history for an animal (current owner or ADMIN)',
      description: 'Oldest interval first. Exactly one record has `isCurrent=true`.',
      security: bearer,
      parameters: [animalIdParam],
      responses: {
        '200': ok('Ownership history', {
          type: 'object',
          properties: {
            data: { type: 'array', items: { $ref: '#/components/schemas/OwnershipRecord' } },
          },
        }),
        ...errs(401, 404),
      },
    },
  },
  '/animals/{animalId}/gallery/upload-url': {
    post: {
      tags: ['Animals'],
      summary: 'Request a presigned upload URL for an animal photo (owner or ADMIN)',
      description:
        'Up to 8 photos. PUT the bytes to `uploadUrl`, then POST .../gallery to register it.',
      security: bearer,
      parameters: [animalIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['filename', 'mimeType', 'size'],
              properties: {
                filename: { type: 'string' },
                mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] },
                size: { type: 'integer', maximum: 5 * 1024 * 1024 },
              },
            },
          },
        },
      },
      responses: { '201': ok('Upload URL issued'), ...errs(400, 401, 404, 422) },
    },
  },
  '/animals/{animalId}/gallery': {
    post: {
      tags: ['Animals'],
      summary: 'Register an uploaded animal photo (owner or ADMIN)',
      security: bearer,
      parameters: [animalIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['storageKey', 'mimeType'],
              properties: { storageKey: { type: 'string' }, mimeType: { type: 'string' } },
            },
          },
        },
      },
      responses: {
        '200': ok('Gallery updated', dataOf({ $ref: '#/components/schemas/Animal' })),
        ...errs(400, 401, 404, 409, 422),
      },
    },
    delete: {
      tags: ['Animals'],
      summary: 'Remove one animal photo by storage key (owner or ADMIN)',
      security: bearer,
      parameters: [
        animalIdParam,
        { name: 'storageKey', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': ok('Gallery updated', dataOf({ $ref: '#/components/schemas/Animal' })),
        ...errs(400, 401, 404, 422),
      },
    },
  },
};

const tags = [
  { name: 'Animals', description: 'Animal Core — create, read, update, deactivate (owner-scoped)' },
  {
    name: 'Animals · Ownership',
    description: 'Ownership transfer and complete ownership history',
  },
];

export const phase4OpenApi = { tags, paths, schemas };
