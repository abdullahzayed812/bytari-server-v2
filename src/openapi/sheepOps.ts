/**
 * OpenAPI fragments for Sheep Farms — mirrors `poultryOps.ts` + the farm-
 * creation part of `phase6.ts`, documenting only the genuinely NEW routes
 * (the sheep-batch entity + its daily records/health events/individual
 * cases, plus `POST /organizations/sheep-farms`). `farm/profile|expenses|
 * appointments|subscription*` are NOT redocumented here — a sheep farm reuses
 * those exact routes/schemas already documented in `poultryOps.ts`/`phase6.ts`
 * unchanged.
 *
 * Permissions: VETERINARIAN → full CRUD; STAFF → `.read` only; OWNER via the
 * organization-owner override; SUPERVISOR via owner selection; ADMIN
 * overrides `authorizeOrg`.
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
    403: 'Lacks the farm.sheep_batch.* / farm.*.* organization permission, or organization not ACTIVE',
    404: 'Not found, or not visible to the caller (batch / record not under this farm)',
    409: 'Conflict with current state (batch closed, duplicate daily-record date)',
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
const batchIdParam = { name: 'batchId', in: 'path', required: true, schema: uuid };
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
];

const tags = [
  {
    name: 'Sheep Farms',
    description:
      'Sheep batches (headcount by lamb/male/female), their daily records, treatments & ' +
      'vaccinations, and individual cases. FARM organizations only. Mirrors Poultry Farm ' +
      'operations exactly for this species.',
  },
];

const schemas: Obj = {
  CreateSheepFarmRequest: {
    type: 'object',
    required: ['name', 'location', 'governorate', 'sheepProductionType'],
    properties: {
      name: { type: 'string' },
      location: { type: 'string' },
      governorate: { type: 'string' },
      sheepProductionType: { type: 'string', enum: ['MEAT', 'DAIRY', 'WOOL', 'BREEDING', 'MIXED', 'OTHER'] },
      description: { type: 'string', nullable: true },
      address: { type: 'string', nullable: true },
      capacity: { type: 'integer', minimum: 0, nullable: true },
      currentSheepCount: { type: 'integer', minimum: 0, nullable: true },
      contactName: { type: 'string', nullable: true },
      contactPhone: { type: 'string', nullable: true },
      contactEmail: { type: 'string', nullable: true },
    },
  },
  SheepBatch: {
    type: 'object',
    properties: {
      id: uuid,
      organizationId: uuid,
      name: { type: 'string' },
      breed: { type: 'string', nullable: true },
      headCount: { type: 'integer' },
      lambCount: { type: 'integer', nullable: true },
      maleCount: { type: 'integer', nullable: true },
      femaleCount: { type: 'integer', nullable: true },
      arrivalDate: dateStr,
      status: { type: 'string', enum: ['ACTIVE', 'CLOSED'] },
      notes: { type: 'string', nullable: true },
      batchNumber: { type: 'integer', nullable: true },
      initialHeadCount: { type: 'integer', nullable: true },
      averageWeightKg: { type: 'string', nullable: true },
      targetPricePerKg: { type: 'string', nullable: true },
      expectedSaleDate: { ...dateStr, nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateSheepBatchRequest: {
    type: 'object',
    required: ['name', 'headCount', 'arrivalDate'],
    properties: {
      name: { type: 'string' },
      breed: { type: 'string', nullable: true },
      headCount: { type: 'integer', minimum: 0 },
      lambCount: { type: 'integer', minimum: 0, nullable: true },
      maleCount: { type: 'integer', minimum: 0, nullable: true },
      femaleCount: { type: 'integer', minimum: 0, nullable: true },
      arrivalDate: dateStr,
      notes: { type: 'string', nullable: true },
      initialHeadCount: { type: 'integer', minimum: 0, nullable: true },
      averageWeightKg: { type: 'number', minimum: 0, nullable: true },
      targetPricePerKg: { type: 'number', minimum: 0, nullable: true },
      expectedSaleDate: { ...dateStr, nullable: true },
    },
  },
  SheepBatchSummary: {
    type: 'object',
    description: 'Every figure is derived from the batch + its daily records.',
    properties: {
      batchId: uuid,
      batchNumber: { type: 'integer', nullable: true },
      status: { type: 'string' },
      breed: { type: 'string', nullable: true },
      name: { type: 'string' },
      arrivalDate: dateStr,
      initialHeadCount: { type: 'integer' },
      currentHeadCount: { type: 'integer' },
      totalMortality: { type: 'integer' },
      ageDays: { type: 'integer' },
      ageWeeks: { type: 'integer' },
      ageMonths: { type: 'integer' },
      averageWeightKg: { type: 'string', nullable: true },
      targetPricePerKg: { type: 'string', nullable: true },
      expectedSaleDate: { ...dateStr, nullable: true },
      totalExpenses: { type: 'number' },
      estimatedProfit: { type: 'number', nullable: true },
      recordsCount: { type: 'integer' },
    },
  },
  SheepWeeklySummary: {
    type: 'object',
    properties: {
      batchId: uuid,
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
      weightChangeKg: { type: 'number', nullable: true },
    },
  },
  SheepDailyRecord: {
    type: 'object',
    properties: {
      id: uuid,
      sheepBatchId: uuid,
      organizationId: uuid,
      recordDate: dateStr,
      feedKg: { type: 'string' },
      waterLiters: { type: 'string' },
      appetite: { type: 'string', nullable: true, enum: ['GOOD', 'NORMAL', 'WEAK', 'NONE'] },
      activity: { type: 'string', nullable: true, enum: ['ACTIVE', 'NORMAL', 'LETHARGIC'] },
      mortalityCount: { type: 'integer' },
      mortalityCause: { type: 'string', nullable: true },
      sickCasesCount: { type: 'integer' },
      feedType: { type: 'string', nullable: true, enum: ['CONCENTRATED', 'GREEN_FODDER', 'MIXED', 'OTHER'] },
      treatment: { type: 'string', nullable: true },
      expenseAmount: { type: 'string' },
      averageWeightKg: { type: 'string', nullable: true },
      notes: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateSheepDailyRecordRequest: {
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
      sickCasesCount: { type: 'integer', minimum: 0 },
      feedType: { type: 'string', nullable: true, enum: ['CONCENTRATED', 'GREEN_FODDER', 'MIXED', 'OTHER'] },
      treatment: { type: 'string', nullable: true },
      expenseAmount: { type: 'number', minimum: 0 },
      averageWeightKg: { type: 'number', minimum: 0, nullable: true },
      notes: { type: 'string', nullable: true },
    },
  },
  SheepHealthEvent: {
    type: 'object',
    properties: {
      id: uuid,
      sheepBatchId: uuid,
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
  SheepCase: {
    type: 'object',
    properties: {
      id: uuid,
      sheepBatchId: uuid,
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
  SheepCaseSummary: {
    type: 'object',
    properties: {
      deceased: { type: 'integer' },
      recovered: { type: 'integer' },
      underTreatment: { type: 'integer' },
    },
  },
};

const T = ['Sheep Farms'];

const paths: Obj = {
  '/organizations/sheep-farms': {
    post: {
      tags: T,
      summary: 'Add Sheep Farm — creates a FARM organization (species=SHEEP), PENDING approval',
      security: bearer,
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateSheepFarmRequest' } } },
      },
      responses: { 201: ok('Created'), ...errs(400, 401, 422) },
    },
  },
  '/organizations/{organizationId}/sheep/batches': {
    parameters: [orgIdParam],
    get: {
      tags: T,
      summary: 'List sheep batches — farm.sheep_batch.read',
      security: bearer,
      parameters: [...pageParams, { name: 'status', in: 'query', schema: { type: 'string', enum: ['ACTIVE', 'CLOSED'] } }],
      responses: { 200: ok('Batches', listOf('#/components/schemas/SheepBatch')), ...errs(400, 401, 403, 404) },
    },
    post: {
      tags: T,
      summary: 'Register a sheep batch — farm.sheep_batch.create',
      security: bearer,
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateSheepBatchRequest' } } },
      },
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/SheepBatch' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/organizations/{organizationId}/sheep/batches/{batchId}': {
    parameters: [orgIdParam, batchIdParam],
    get: {
      tags: T,
      summary: 'Get a sheep batch — farm.sheep_batch.read',
      security: bearer,
      responses: { 200: ok('Batch', dataOf({ $ref: '#/components/schemas/SheepBatch' })), ...errs(401, 403, 404) },
    },
    patch: {
      tags: T,
      summary: 'Update a sheep batch — farm.sheep_batch.update',
      security: bearer,
      responses: {
        200: ok('Updated', dataOf({ $ref: '#/components/schemas/SheepBatch' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
    delete: {
      tags: T,
      summary: 'Delete a sheep batch — farm.sheep_batch.delete',
      security: bearer,
      responses: { 200: ok('Deleted'), ...errs(401, 403, 404) },
    },
  },
  '/organizations/{organizationId}/sheep/batches/{batchId}/summary': {
    parameters: [orgIdParam, batchIdParam],
    get: {
      tags: T,
      summary: 'Batch summary (server-computed) — farm.sheep_batch.read',
      security: bearer,
      responses: {
        200: ok('Batch summary', dataOf({ $ref: '#/components/schemas/SheepBatchSummary' })),
        ...errs(400, 401, 403, 404),
      },
    },
  },
  '/organizations/{organizationId}/sheep/batches/{batchId}/weekly-summary': {
    parameters: [orgIdParam, batchIdParam, { name: 'weekOf', in: 'query', schema: dateStr }],
    get: {
      tags: T,
      summary: 'Weekly summary (server-computed) — farm.sheep_batch.read',
      security: bearer,
      responses: {
        200: ok('Weekly summary', dataOf({ $ref: '#/components/schemas/SheepWeeklySummary' })),
        ...errs(400, 401, 403, 404),
      },
    },
  },
  '/organizations/{organizationId}/sheep/batches/{batchId}/daily-records': {
    parameters: [orgIdParam, batchIdParam],
    get: {
      tags: T,
      summary: 'List daily records — farm.daily_record.read',
      security: bearer,
      parameters: [...pageParams, { name: 'from', in: 'query', schema: dateStr }, { name: 'to', in: 'query', schema: dateStr }],
      responses: {
        200: ok('Daily records', listOf('#/components/schemas/SheepDailyRecord')),
        ...errs(400, 401, 403, 404),
      },
    },
    post: {
      tags: T,
      summary: 'Add a daily record — farm.daily_record.create',
      security: bearer,
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateSheepDailyRecordRequest' } } },
      },
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/SheepDailyRecord' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
  },
  '/organizations/{organizationId}/sheep/batches/{batchId}/daily-records/{recordId}': {
    parameters: [orgIdParam, batchIdParam, { name: 'recordId', in: 'path', required: true, schema: uuid }],
    get: {
      tags: T,
      summary: 'Get a daily record — farm.daily_record.read',
      security: bearer,
      responses: { 200: ok('Daily record', dataOf({ $ref: '#/components/schemas/SheepDailyRecord' })), ...errs(401, 403, 404) },
    },
    patch: {
      tags: T,
      summary: 'Update a daily record — farm.daily_record.update',
      security: bearer,
      responses: {
        200: ok('Updated', dataOf({ $ref: '#/components/schemas/SheepDailyRecord' })),
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
  '/organizations/{organizationId}/sheep/batches/{batchId}/health-events': {
    parameters: [orgIdParam, batchIdParam],
    get: {
      tags: T,
      summary: 'List treatments & vaccinations — farm.health_event.read',
      security: bearer,
      parameters: [...pageParams, { name: 'kind', in: 'query', schema: { type: 'string', enum: ['TREATMENT', 'VACCINATION'] } }],
      responses: {
        200: ok('Health events', listOf('#/components/schemas/SheepHealthEvent')),
        ...errs(400, 401, 403, 404),
      },
    },
    post: {
      tags: T,
      summary: 'Record a treatment or vaccination — farm.health_event.create',
      security: bearer,
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/SheepHealthEvent' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/organizations/{organizationId}/sheep/batches/{batchId}/cases': {
    parameters: [orgIdParam, batchIdParam],
    get: {
      tags: T,
      summary: 'List individual cases — farm.case.read',
      security: bearer,
      parameters: [...pageParams, { name: 'status', in: 'query', schema: { type: 'string', enum: ['UNDER_TREATMENT', 'RECOVERED', 'DECEASED'] } }],
      responses: { 200: ok('Cases', listOf('#/components/schemas/SheepCase')), ...errs(400, 401, 403, 404) },
    },
    post: {
      tags: T,
      summary: 'Open an individual case — farm.case.create',
      security: bearer,
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/SheepCase' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/organizations/{organizationId}/sheep/batches/{batchId}/cases/summary': {
    parameters: [orgIdParam, batchIdParam],
    get: {
      tags: T,
      summary: 'Case stat chips — farm.case.read',
      security: bearer,
      responses: { 200: ok('Summary', dataOf({ $ref: '#/components/schemas/SheepCaseSummary' })), ...errs(400, 401, 403, 404) },
    },
  },
};

export const sheepOpsOpenApi = { tags, paths, schemas };
