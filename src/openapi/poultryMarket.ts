/**
 * OpenAPI fragment — Poultry Markets module: trader registration, poultry/egg
 * classified offers, the two exchange-rate ("bourse") boards, and the
 * governorate statistics summary. Trader status is a per-USER concept — no
 * route here carries an `:organizationId`.
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
    403: 'Missing permission, or requires an approved trader account',
    404: 'Not found',
    409: 'Conflict with current state (already pending/approved/suspended)',
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
const userIdParam = { name: 'userId', in: 'path', required: true, schema: uuid };
const offerIdParam = { name: 'offerId', in: 'path', required: true, schema: uuid };
const dateParam = {
  name: 'date',
  in: 'query',
  required: true,
  schema: { type: 'string', format: 'date' },
};
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
];

const tags = [
  {
    name: 'Poultry Markets',
    description:
      'Trader registration (per-user, admin-approved), poultry/egg classified offers ' +
      '(auto-published for an approved trader), the poultry & egg exchange-rate boards, ' +
      'and the governorate statistics summary.',
  },
];

const schemas: Obj = {
  TraderProfile: {
    type: 'object',
    properties: {
      id: uuid,
      userId: uuid,
      displayName: { type: 'string' },
      traderType: { type: 'string', enum: ['WHOLESALE', 'INDIVIDUAL', 'EXPORTER', 'OTHER'] },
      governorate: { type: 'string' },
      district: { type: 'string', nullable: true },
      phone: { type: 'string' },
      whatsapp: { type: 'string', nullable: true },
      bio: { type: 'string', nullable: true },
      status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] },
      decisionReason: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  PoultryOffer: {
    type: 'object',
    properties: {
      id: uuid,
      traderUserId: uuid,
      birdType: { type: 'string', enum: ['BALADI', 'LAYER', 'BROILER', 'ROOSTER', 'TURKEY', 'OTHER'] },
      breed: { type: 'string', nullable: true },
      quantity: { type: 'integer' },
      pricingMethod: { type: 'string', enum: ['PER_KG', 'PER_BIRD'] },
      price: { type: 'string' },
      ageWeeks: { type: 'integer', nullable: true },
      weightKg: { type: 'string', nullable: true },
      governorate: { type: 'string' },
      district: { type: 'string', nullable: true },
      phone: { type: 'string' },
      whatsapp: { type: 'string', nullable: true },
      notes: { type: 'string', nullable: true },
      imageUrls: { type: 'array', items: { type: 'string' } },
      status: { type: 'string', enum: ['ACTIVE', 'REMOVED'] },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  EggOffer: {
    type: 'object',
    properties: {
      id: uuid,
      traderUserId: uuid,
      eggType: { type: 'string', enum: ['ORGANIC', 'BROWN', 'WHITE', 'OTHER', 'TURKEY', 'BALADI'] },
      sellUnit: { type: 'string', enum: ['PIECE', 'CARTON_360', 'TRAY_30'] },
      quantity: { type: 'integer' },
      pricePerUnit: { type: 'string' },
      governorate: { type: 'string' },
      district: { type: 'string', nullable: true },
      phone: { type: 'string' },
      whatsapp: { type: 'string', nullable: true },
      notes: { type: 'string', nullable: true },
      imageUrls: { type: 'array', items: { type: 'string' } },
      status: { type: 'string', enum: ['ACTIVE', 'REMOVED'] },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  PoultryRateEntry: {
    type: 'object',
    properties: {
      governorate: { type: 'string' },
      meatPricePerKg: { type: 'string', nullable: true },
      layerPricePerBird: { type: 'string', nullable: true },
      meatTrend: { type: 'string', enum: ['UP', 'DOWN', 'FLAT'], nullable: true },
      layerTrend: { type: 'string', enum: ['UP', 'DOWN', 'FLAT'], nullable: true },
    },
  },
  EggRateEntry: {
    type: 'object',
    properties: {
      governorate: { type: 'string' },
      eggPricePerTray: { type: 'string', nullable: true },
      trend: { type: 'string', enum: ['UP', 'DOWN', 'FLAT'], nullable: true },
    },
  },
  MarketStatisticsSummary: {
    type: 'object',
    properties: {
      totalFarms: { type: 'integer' },
      totalBirds: { type: 'integer' },
      byGovernorate: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            governorate: { type: 'string' },
            farmCount: { type: 'integer' },
            totalBirds: { type: 'integer' },
          },
        },
      },
    },
  },
};

const paths: Obj = {
  '/traders/register': {
    post: {
      tags: ['Poultry Markets'],
      summary: 'Register (or reapply) as a trader',
      security: bearer,
      responses: {
        201: ok('Registered — PENDING', dataOf({ $ref: '#/components/schemas/TraderProfile' })),
        ...errs(401, 409, 422),
      },
    },
  },
  '/traders/me': {
    get: {
      tags: ['Poultry Markets'],
      summary: 'My trader status + profile (if any)',
      security: bearer,
      responses: { 200: ok('OK'), ...errs(401) },
    },
  },
  '/admin/traders': {
    get: {
      tags: ['Poultry Markets'],
      summary: 'List trader applications — trader.admin.read',
      security: bearer,
      parameters: [
        ...pageParams,
        { name: 'status', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        200: ok('OK', listOf('#/components/schemas/TraderProfile')),
        ...errs(401, 403),
      },
    },
  },
  '/admin/traders/{userId}/approve': {
    parameters: [userIdParam],
    post: {
      tags: ['Poultry Markets'],
      summary: 'Approve a pending trader registration — trader.admin.approve',
      security: bearer,
      responses: {
        200: ok('Approved', dataOf({ $ref: '#/components/schemas/TraderProfile' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/traders/{userId}/reject': {
    parameters: [userIdParam],
    post: {
      tags: ['Poultry Markets'],
      summary: 'Reject a pending trader registration — trader.admin.reject',
      security: bearer,
      responses: {
        200: ok('Rejected', dataOf({ $ref: '#/components/schemas/TraderProfile' })),
        ...errs(401, 403, 404, 422),
      },
    },
  },
  '/admin/traders/{userId}/suspend': {
    parameters: [userIdParam],
    post: {
      tags: ['Poultry Markets'],
      summary: 'Suspend an approved trader — trader.admin.suspend',
      security: bearer,
      responses: {
        200: ok('Suspended', dataOf({ $ref: '#/components/schemas/TraderProfile' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/traders/{userId}/reactivate': {
    parameters: [userIdParam],
    post: {
      tags: ['Poultry Markets'],
      summary: 'Reactivate a suspended trader — trader.admin.suspend',
      security: bearer,
      responses: {
        200: ok('Reactivated', dataOf({ $ref: '#/components/schemas/TraderProfile' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/poultry-offers': {
    get: {
      tags: ['Poultry Markets'],
      summary: 'Browse active poultry offers (any authenticated user)',
      security: bearer,
      parameters: [
        ...pageParams,
        { name: 'birdType', in: 'query', schema: { type: 'string' } },
        { name: 'governorate', in: 'query', schema: { type: 'string' } },
      ],
      responses: { 200: ok('OK', listOf('#/components/schemas/PoultryOffer')), ...errs(401) },
    },
    post: {
      tags: ['Poultry Markets'],
      summary: 'Create a poultry offer — requires an approved trader',
      security: bearer,
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/PoultryOffer' })),
        ...errs(401, 403, 422),
      },
    },
  },
  '/poultry-offers/mine': {
    get: {
      tags: ['Poultry Markets'],
      summary: "My poultry offers — requires an approved trader",
      security: bearer,
      parameters: pageParams,
      responses: { 200: ok('OK', listOf('#/components/schemas/PoultryOffer')), ...errs(401, 403) },
    },
  },
  '/poultry-offers/{offerId}': {
    parameters: [offerIdParam],
    get: {
      tags: ['Poultry Markets'],
      summary: 'Poultry offer detail',
      security: bearer,
      responses: {
        200: ok('OK', dataOf({ $ref: '#/components/schemas/PoultryOffer' })),
        ...errs(401, 404),
      },
    },
    delete: {
      tags: ['Poultry Markets'],
      summary: 'Remove my offer (owner or market.offer.admin.delete)',
      security: bearer,
      responses: { 200: ok('Removed'), ...errs(401, 403, 404) },
    },
  },
  '/admin/poultry-offers': {
    get: {
      tags: ['Poultry Markets'],
      summary: 'Admin: list every poultry offer — market.offer.admin.read',
      security: bearer,
      parameters: pageParams,
      responses: { 200: ok('OK', listOf('#/components/schemas/PoultryOffer')), ...errs(401, 403) },
    },
  },
  '/admin/poultry-offers/{offerId}': {
    parameters: [offerIdParam],
    delete: {
      tags: ['Poultry Markets'],
      summary: 'Admin: delete any poultry offer — market.offer.admin.delete',
      security: bearer,
      responses: { 200: ok('Removed'), ...errs(401, 403, 404) },
    },
  },
  '/egg-offers': {
    get: {
      tags: ['Poultry Markets'],
      summary: 'Browse active egg offers (any authenticated user)',
      security: bearer,
      parameters: [
        ...pageParams,
        { name: 'eggType', in: 'query', schema: { type: 'string' } },
        { name: 'governorate', in: 'query', schema: { type: 'string' } },
      ],
      responses: { 200: ok('OK', listOf('#/components/schemas/EggOffer')), ...errs(401) },
    },
    post: {
      tags: ['Poultry Markets'],
      summary: 'Create an egg offer — requires an approved trader',
      security: bearer,
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/EggOffer' })),
        ...errs(401, 403, 422),
      },
    },
  },
  '/egg-offers/mine': {
    get: {
      tags: ['Poultry Markets'],
      summary: 'My egg offers — requires an approved trader',
      security: bearer,
      parameters: pageParams,
      responses: { 200: ok('OK', listOf('#/components/schemas/EggOffer')), ...errs(401, 403) },
    },
  },
  '/egg-offers/{offerId}': {
    parameters: [offerIdParam],
    get: {
      tags: ['Poultry Markets'],
      summary: 'Egg offer detail',
      security: bearer,
      responses: {
        200: ok('OK', dataOf({ $ref: '#/components/schemas/EggOffer' })),
        ...errs(401, 404),
      },
    },
    delete: {
      tags: ['Poultry Markets'],
      summary: 'Remove my offer (owner or market.offer.admin.delete)',
      security: bearer,
      responses: { 200: ok('Removed'), ...errs(401, 403, 404) },
    },
  },
  '/admin/egg-offers': {
    get: {
      tags: ['Poultry Markets'],
      summary: 'Admin: list every egg offer — market.offer.admin.read',
      security: bearer,
      parameters: pageParams,
      responses: { 200: ok('OK', listOf('#/components/schemas/EggOffer')), ...errs(401, 403) },
    },
  },
  '/admin/egg-offers/{offerId}': {
    parameters: [offerIdParam],
    delete: {
      tags: ['Poultry Markets'],
      summary: 'Admin: delete any egg offer — market.offer.admin.delete',
      security: bearer,
      responses: { 200: ok('Removed'), ...errs(401, 403, 404) },
    },
  },
  '/poultry-market/exchange-rates/poultry': {
    get: {
      tags: ['Poultry Markets'],
      summary: 'Poultry bourse for a date (any authenticated user)',
      security: bearer,
      parameters: [dateParam],
      responses: {
        200: ok('OK', dataOf({ type: 'array', items: { $ref: '#/components/schemas/PoultryRateEntry' } })),
        ...errs(401, 422),
      },
    },
    post: {
      tags: ['Poultry Markets'],
      summary: 'Save a day of poultry-bourse rates — market.rate.manage',
      security: bearer,
      responses: { 200: ok('Saved'), ...errs(401, 403, 422) },
    },
  },
  '/poultry-market/exchange-rates/egg': {
    get: {
      tags: ['Poultry Markets'],
      summary: 'Egg bourse for a date (any authenticated user)',
      security: bearer,
      parameters: [dateParam],
      responses: {
        200: ok('OK', dataOf({ type: 'array', items: { $ref: '#/components/schemas/EggRateEntry' } })),
        ...errs(401, 422),
      },
    },
    post: {
      tags: ['Poultry Markets'],
      summary: 'Save a day of egg-bourse rates — market.rate.manage',
      security: bearer,
      responses: { 200: ok('Saved'), ...errs(401, 403, 422) },
    },
  },
  '/poultry-market/statistics': {
    get: {
      tags: ['Poultry Markets'],
      summary: 'Governorate farm/bird distribution — admin or approved trader only',
      security: bearer,
      responses: {
        200: ok('OK', dataOf({ $ref: '#/components/schemas/MarketStatisticsSummary' })),
        ...errs(401, 403),
      },
    },
  },
};

export const poultryMarketOpenApi = { tags, paths, schemas };
