/**
 * OpenAPI fragments for Poultry Farm operations — the Farm Details screen.
 * Extends `/organizations/:organizationId/...`. Every route:
 * authenticate → withOrganization → withFarmOrganization (400 non-FARM) →
 * authorizeOrg('farm.*') → [per-flock scoping for flock routes] → controller.
 *
 * Permissions: VETERINARIAN → full CRUD on every entity; STAFF → `.read` only;
 * OWNER via the organization-owner override; SUPERVISOR via owner selection;
 * ADMIN overrides `authorizeOrg`. Batch / weekly summaries read with
 * `farm.poultry.read`; the farm-profile header writes with `organization.update`.
 * All figures on the summary endpoints are computed server-side from the daily
 * records — never stored or client-supplied.
 */
type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request, or the organization is not a FARM',
    401: 'Missing or invalid access token',
    403: 'Lacks the farm.* organization permission, or organization not ACTIVE',
    404: 'Not found, or not visible to the caller (flock / record not under this farm)',
    409: 'Conflict with current state (flock closed, duplicate daily-record date)',
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
const dateStr = { type: 'string', format: 'date' };
const orgIdParam = { name: 'organizationId', in: 'path', required: true, schema: uuid };
const flockIdParam = { name: 'flockId', in: 'path', required: true, schema: uuid };
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
];

const tags = [
  {
    name: 'Poultry Farm operations',
    description:
      'Farm Details screen: daily records, server-computed batch & weekly summaries, ' +
      'expenses, treatments & vaccinations, appointments, individual cases, and the ' +
      'farm-profile header. FARM organizations only.',
  },
];

const schemas: Obj = {
  FarmProfile: {
    type: 'object',
    properties: {
      imageUrl: { type: 'string', nullable: true },
      location: { type: 'string', nullable: true },
      governorate: { type: 'string', nullable: true },
      address: { type: 'string', nullable: true },
      capacity: { type: 'integer', nullable: true },
      currentBirdCount: { type: 'integer', nullable: true },
      establishedOn: { ...dateStr, nullable: true },
      poultryProductionType: {
        type: 'string',
        nullable: true,
        enum: ['BROILER', 'LAYER', 'MIXED', 'BREEDER', 'HATCHERY', 'OTHER'],
      },
      contactName: { type: 'string', nullable: true },
      contactPhone: { type: 'string', nullable: true },
      contactEmail: { type: 'string', nullable: true },
    },
  },
  UpdateFarmProfileRequest: {
    type: 'object',
    properties: {
      location: { type: 'string', nullable: true },
      governorate: { type: 'string', nullable: true },
      address: { type: 'string', nullable: true },
      capacity: { type: 'integer', minimum: 0, nullable: true },
      currentBirdCount: { type: 'integer', minimum: 0, nullable: true },
      establishedOn: { ...dateStr, nullable: true },
      poultryProductionType: {
        type: 'string',
        nullable: true,
        enum: ['BROILER', 'LAYER', 'MIXED', 'BREEDER', 'HATCHERY', 'OTHER'],
      },
      contactName: { type: 'string', nullable: true },
      contactPhone: { type: 'string', nullable: true },
      contactEmail: { type: 'string', nullable: true },
    },
  },
  PoultryDailyRecord: {
    type: 'object',
    properties: {
      id: uuid,
      poultryFlockId: uuid,
      organizationId: uuid,
      recordDate: dateStr,
      feedKg: { type: 'string' },
      waterLiters: { type: 'string' },
      appetite: { type: 'string', nullable: true, enum: ['GOOD', 'NORMAL', 'WEAK', 'NONE'] },
      activity: { type: 'string', nullable: true, enum: ['ACTIVE', 'NORMAL', 'LETHARGIC'] },
      mortalityCount: { type: 'integer' },
      mortalityCause: { type: 'string', nullable: true },
      treatment: { type: 'string', nullable: true },
      expenseAmount: { type: 'string' },
      averageWeightGrams: { type: 'string', nullable: true },
      notes: { type: 'string', nullable: true },
      createdByUserId: { ...uuid, nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateDailyRecordRequest: {
    type: 'object',
    required: ['recordDate'],
    properties: {
      recordDate: dateStr,
      feedKg: { type: 'number', minimum: 0 },
      waterLiters: { type: 'number', minimum: 0 },
      appetite: { type: 'string', nullable: true, enum: ['GOOD', 'NORMAL', 'WEAK', 'NONE'] },
      activity: { type: 'string', nullable: true, enum: ['ACTIVE', 'NORMAL', 'LETHARGIC'] },
      mortalityCount: { type: 'integer', minimum: 0 },
      mortalityCause: { type: 'string', nullable: true },
      treatment: { type: 'string', nullable: true },
      expenseAmount: { type: 'number', minimum: 0 },
      averageWeightGrams: { type: 'number', minimum: 0, nullable: true },
      notes: { type: 'string', nullable: true },
    },
  },
  BatchSummary: {
    type: 'object',
    description: 'Every figure is derived from the flock + its daily records.',
    properties: {
      flockId: uuid,
      batchNumber: { type: 'integer', nullable: true },
      status: { type: 'string' },
      birdType: { type: 'string' },
      name: { type: 'string' },
      arrivalDate: dateStr,
      initialBirdCount: { type: 'integer' },
      currentBirdCount: { type: 'integer' },
      totalMortality: { type: 'integer' },
      ageDays: { type: 'integer' },
      ageWeeks: { type: 'integer' },
      ageMonths: { type: 'integer' },
      averageWeightGrams: { type: 'string', nullable: true },
      targetPricePerKg: { type: 'string', nullable: true },
      expectedSaleDate: { ...dateStr, nullable: true },
      totalExpenses: { type: 'number' },
      estimatedProfit: {
        type: 'number',
        nullable: true,
        description: 'null unless targetPricePerKg and averageWeightGrams are both set',
      },
      recordsCount: { type: 'integer' },
    },
  },
  WeeklySummary: {
    type: 'object',
    properties: {
      flockId: uuid,
      weekStart: dateStr,
      weekEnd: dateStr,
      recordsCount: { type: 'integer' },
      averageMortality: { type: 'number' },
      averageFeedKg: { type: 'number' },
      averageWaterLiters: { type: 'number' },
      totalMortality: { type: 'integer' },
      totalFeedKg: { type: 'number' },
      totalWaterLiters: { type: 'number' },
      totalExpenses: { type: 'number' },
      weightChangeGrams: { type: 'number', nullable: true },
    },
  },
  FarmExpense: {
    type: 'object',
    properties: {
      id: uuid,
      organizationId: uuid,
      poultryFlockId: { ...uuid, nullable: true },
      category: {
        type: 'string',
        enum: ['FEED', 'MEDICINE', 'WATER_TRANSPORT', 'LABOR', 'UTILITIES', 'EQUIPMENT', 'OTHER'],
      },
      amount: { type: 'string' },
      description: { type: 'string', nullable: true },
      spentOn: dateStr,
      createdByUserId: { ...uuid, nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  FarmExpenseSummary: {
    type: 'object',
    properties: {
      totalThisWeek: { type: 'number' },
      totalThisMonth: { type: 'number' },
      dailyAverageThisMonth: { type: 'number' },
    },
  },
  PoultryHealthEvent: {
    type: 'object',
    properties: {
      id: uuid,
      poultryFlockId: uuid,
      organizationId: uuid,
      kind: { type: 'string', enum: ['TREATMENT', 'VACCINATION'] },
      name: { type: 'string' },
      medication: { type: 'string', nullable: true },
      dose: { type: 'string', nullable: true },
      eventDate: dateStr,
      casesCount: { type: 'integer', nullable: true },
      coverageCount: { type: 'integer', nullable: true },
      nextDueDate: { ...dateStr, nullable: true },
      status: { type: 'string', enum: ['SCHEDULED', 'ONGOING', 'DONE', 'RECOVERED'] },
      notes: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  FarmAppointment: {
    type: 'object',
    properties: {
      id: uuid,
      organizationId: uuid,
      poultryFlockId: { ...uuid, nullable: true },
      title: { type: 'string' },
      description: { type: 'string', nullable: true },
      category: {
        type: 'string',
        enum: ['VACCINATION', 'TREATMENT', 'INDIVIDUAL_CASE', 'VET_VISIT', 'OTHER'],
      },
      scheduledFor: dateStr,
      status: { type: 'string', enum: ['UPCOMING', 'DONE', 'CANCELLED'] },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  PoultryCase: {
    type: 'object',
    properties: {
      id: uuid,
      poultryFlockId: uuid,
      organizationId: uuid,
      caseNumber: { type: 'integer', nullable: true },
      animalTag: { type: 'string', nullable: true },
      sex: { type: 'string', enum: ['MALE', 'FEMALE', 'UNKNOWN'] },
      diagnosis: { type: 'string', nullable: true },
      treatment: { type: 'string', nullable: true },
      status: { type: 'string', enum: ['UNDER_TREATMENT', 'RECOVERED', 'DECEASED'] },
      startedOn: dateStr,
      nextFollowupOn: { ...dateStr, nullable: true },
      imageUrl: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  PoultryCaseSummary: {
    type: 'object',
    properties: {
      deceased: { type: 'integer' },
      recovered: { type: 'integer' },
      underTreatment: { type: 'integer' },
    },
  },
  FarmSubscriptionRenewalRequest: {
    type: 'object',
    properties: {
      id: uuid,
      organizationId: uuid,
      requestedByUserId: uuid,
      status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
      note: { type: 'string', nullable: true },
      previousSubscriptionEndDate: { ...dateStr, nullable: true },
      newSubscriptionStartDate: { ...dateStr, nullable: true },
      newSubscriptionEndDate: { ...dateStr, nullable: true },
      decidedBy: { ...uuid, nullable: true },
      decidedAt: { type: 'string', format: 'date-time', nullable: true },
      decisionReason: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateRenewalRequestRequest: {
    type: 'object',
    properties: { note: { type: 'string', nullable: true } },
  },
  SetSubscriptionRequest: {
    type: 'object',
    required: ['startDate', 'endDate'],
    properties: { startDate: dateStr, endDate: dateStr },
  },
  ApproveRenewalRequest: {
    type: 'object',
    required: ['startDate', 'endDate'],
    properties: { startDate: dateStr, endDate: dateStr },
  },
  RejectRenewalRequest: {
    type: 'object',
    required: ['reason'],
    properties: { reason: { type: 'string', minLength: 3 } },
  },
};

const T = ['Poultry Farm operations'];

const paths: Obj = {
  '/organizations/{organizationId}/farm/profile': {
    parameters: [orgIdParam],
    get: {
      tags: T,
      summary: 'Farm Details header — organization.read',
      security: bearer,
      responses: {
        200: ok('Farm profile', dataOf({ $ref: '#/components/schemas/FarmProfile' })),
        ...errs(400, 401, 403, 404),
      },
    },
    patch: {
      tags: T,
      summary: 'Update the farm-profile header — organization.update',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateFarmProfileRequest' },
          },
        },
      },
      responses: {
        200: ok('Updated', dataOf({ $ref: '#/components/schemas/FarmProfile' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/organizations/{organizationId}/poultry/flocks/{flockId}/summary': {
    parameters: [orgIdParam, flockIdParam],
    get: {
      tags: T,
      summary: 'Batch summary (server-computed) — farm.poultry.read',
      security: bearer,
      responses: {
        200: ok('Batch summary', dataOf({ $ref: '#/components/schemas/BatchSummary' })),
        ...errs(400, 401, 403, 404),
      },
    },
  },
  '/organizations/{organizationId}/poultry/flocks/{flockId}/weekly-summary': {
    parameters: [
      orgIdParam,
      flockIdParam,
      { name: 'weekOf', in: 'query', schema: dateStr, description: 'Any date in the target week' },
    ],
    get: {
      tags: T,
      summary: 'Weekly summary (server-computed) — farm.poultry.read',
      security: bearer,
      responses: {
        200: ok('Weekly summary', dataOf({ $ref: '#/components/schemas/WeeklySummary' })),
        ...errs(400, 401, 403, 404),
      },
    },
  },
  '/organizations/{organizationId}/poultry/flocks/{flockId}/daily-records': {
    parameters: [orgIdParam, flockIdParam],
    get: {
      tags: T,
      summary: 'List daily records — farm.daily_record.read',
      security: bearer,
      parameters: [
        ...pageParams,
        { name: 'from', in: 'query', schema: dateStr },
        { name: 'to', in: 'query', schema: dateStr },
      ],
      responses: {
        200: ok('Daily records', listOf('#/components/schemas/PoultryDailyRecord')),
        ...errs(400, 401, 403, 404),
      },
    },
    post: {
      tags: T,
      summary: 'Add a daily record — farm.daily_record.create',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateDailyRecordRequest' },
          },
        },
      },
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/PoultryDailyRecord' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
  },
  '/organizations/{organizationId}/poultry/flocks/{flockId}/daily-records/{recordId}': {
    parameters: [
      orgIdParam,
      flockIdParam,
      { name: 'recordId', in: 'path', required: true, schema: uuid },
    ],
    get: {
      tags: T,
      summary: 'Get a daily record — farm.daily_record.read',
      security: bearer,
      responses: {
        200: ok('Daily record', dataOf({ $ref: '#/components/schemas/PoultryDailyRecord' })),
        ...errs(401, 403, 404),
      },
    },
    patch: {
      tags: T,
      summary: 'Update a daily record — farm.daily_record.update',
      security: bearer,
      responses: {
        200: ok('Updated', dataOf({ $ref: '#/components/schemas/PoultryDailyRecord' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
    delete: {
      tags: T,
      summary: 'Delete a daily record — farm.daily_record.delete',
      security: bearer,
      responses: { 200: ok('Deleted'), ...errs(401, 403, 404) },
    },
  },
  '/organizations/{organizationId}/farm/expenses': {
    parameters: [orgIdParam],
    get: {
      tags: T,
      summary: 'List expenses — farm.expense.read',
      security: bearer,
      parameters: [
        ...pageParams,
        {
          name: 'category',
          in: 'query',
          schema: {
            type: 'string',
            enum: [
              'FEED',
              'MEDICINE',
              'WATER_TRANSPORT',
              'LABOR',
              'UTILITIES',
              'EQUIPMENT',
              'OTHER',
            ],
          },
        },
      ],
      responses: {
        200: ok('Expenses', listOf('#/components/schemas/FarmExpense')),
        ...errs(400, 401, 403, 404),
      },
    },
    post: {
      tags: T,
      summary: 'Record an expense — farm.expense.create',
      security: bearer,
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/FarmExpense' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/organizations/{organizationId}/farm/expenses/summary': {
    parameters: [orgIdParam],
    get: {
      tags: T,
      summary: 'Expense summary cards — farm.expense.read',
      security: bearer,
      responses: {
        200: ok('Summary', dataOf({ $ref: '#/components/schemas/FarmExpenseSummary' })),
        ...errs(400, 401, 403, 404),
      },
    },
  },
  '/organizations/{organizationId}/poultry/flocks/{flockId}/health-events': {
    parameters: [orgIdParam, flockIdParam],
    get: {
      tags: T,
      summary: 'List treatments & vaccinations — farm.health_event.read',
      security: bearer,
      parameters: [
        ...pageParams,
        {
          name: 'kind',
          in: 'query',
          schema: { type: 'string', enum: ['TREATMENT', 'VACCINATION'] },
        },
      ],
      responses: {
        200: ok('Health events', listOf('#/components/schemas/PoultryHealthEvent')),
        ...errs(400, 401, 403, 404),
      },
    },
    post: {
      tags: T,
      summary: 'Record a treatment or vaccination — farm.health_event.create',
      security: bearer,
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/PoultryHealthEvent' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/organizations/{organizationId}/farm/appointments': {
    parameters: [orgIdParam],
    get: {
      tags: T,
      summary: 'List appointments — farm.appointment.read',
      security: bearer,
      parameters: pageParams,
      responses: {
        200: ok('Appointments', listOf('#/components/schemas/FarmAppointment')),
        ...errs(400, 401, 403, 404),
      },
    },
    post: {
      tags: T,
      summary: 'Schedule an appointment — farm.appointment.create',
      security: bearer,
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/FarmAppointment' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/organizations/{organizationId}/poultry/flocks/{flockId}/cases': {
    parameters: [orgIdParam, flockIdParam],
    get: {
      tags: T,
      summary: 'List individual cases — farm.case.read',
      security: bearer,
      parameters: [
        ...pageParams,
        {
          name: 'status',
          in: 'query',
          schema: { type: 'string', enum: ['UNDER_TREATMENT', 'RECOVERED', 'DECEASED'] },
        },
      ],
      responses: {
        200: ok('Cases', listOf('#/components/schemas/PoultryCase')),
        ...errs(400, 401, 403, 404),
      },
    },
    post: {
      tags: T,
      summary: 'Open an individual case — farm.case.create',
      security: bearer,
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/PoultryCase' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/organizations/{organizationId}/poultry/flocks/{flockId}/cases/summary': {
    parameters: [orgIdParam, flockIdParam],
    get: {
      tags: T,
      summary: 'Case stat chips — farm.case.read',
      security: bearer,
      responses: {
        200: ok('Summary', dataOf({ $ref: '#/components/schemas/PoultryCaseSummary' })),
        ...errs(400, 401, 403, 404),
      },
    },
  },
  '/organizations/{organizationId}/farm/subscription': {
    parameters: [orgIdParam],
    post: {
      tags: T,
      summary:
        'Set the farm subscription period directly — farm.subscription.manage ' +
        '(owner override / assigned supervisor / admin)',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/SetSubscriptionRequest' } },
        },
      },
      responses: { 200: ok('Updated'), ...errs(400, 401, 403, 404, 422) },
    },
  },
  '/organizations/{organizationId}/farm/subscription-renewals': {
    parameters: [orgIdParam],
    get: {
      tags: T,
      summary:
        'List this farm’s subscription renewal requests — farm.subscription.read ' +
        '(owner may read even while not ACTIVE)',
      security: bearer,
      parameters: [
        ...pageParams,
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] } },
      ],
      responses: {
        200: ok('Renewal requests', listOf('#/components/schemas/FarmSubscriptionRenewalRequest')),
        ...errs(400, 401, 403, 404),
      },
    },
    post: {
      tags: T,
      summary:
        'Request a subscription renewal — owner only, subscription must be EXPIRED, ' +
        'at most one open request at a time',
      security: bearer,
      requestBody: {
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateRenewalRequestRequest' },
          },
        },
      },
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/FarmSubscriptionRenewalRequest' })),
        ...errs(400, 401, 403, 404, 409),
      },
    },
  },
  '/organizations/{organizationId}/farm/subscription-renewals/{requestId}/approve': {
    parameters: [orgIdParam, { name: 'requestId', in: 'path', required: true, schema: uuid }],
    post: {
      tags: T,
      summary: 'Approve a renewal request and set the new subscription period — farm.subscription.manage',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ApproveRenewalRequest' } },
        },
      },
      responses: {
        200: ok('Approved', dataOf({ $ref: '#/components/schemas/FarmSubscriptionRenewalRequest' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
  },
  '/organizations/{organizationId}/farm/subscription-renewals/{requestId}/reject': {
    parameters: [orgIdParam, { name: 'requestId', in: 'path', required: true, schema: uuid }],
    post: {
      tags: T,
      summary: 'Reject a renewal request — farm.subscription.manage',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/RejectRenewalRequest' } },
        },
      },
      responses: {
        200: ok('Rejected', dataOf({ $ref: '#/components/schemas/FarmSubscriptionRenewalRequest' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
  },
};

export const poultryOpsOpenApi = { tags, paths, schemas };
