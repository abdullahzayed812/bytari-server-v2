/**
 * OpenAPI fragments for Cattle Farms — mirrors `poultryOps.ts` + the farm-
 * creation part of `phase6.ts`, documenting only the genuinely NEW routes
 * (the cattle-batch entity + its daily records/health events/individual
 * cases, plus `POST /organizations/cattle-farms`). `farm/profile|expenses|
 * appointments|subscription*` are NOT redocumented here — a cattle farm reuses
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
    403: 'Lacks the farm.cattle_batch.* / farm.*.* organization permission, or organization not ACTIVE',
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
    name: 'Cattle Farms',
    description:
      'Cattle batches (headcount by lamb/male/female), their daily records, treatments & ' +
      'vaccinations, and individual cases. FARM organizations only. Mirrors Poultry Farm ' +
      'operations exactly for this species.',
  },
];

const schemas: Obj = {
  CreateCattleFarmRequest: {
    type: 'object',
    required: ['name', 'location', 'governorate', 'cattleProductionType'],
    properties: {
      name: { type: 'string' },
      location: { type: 'string' },
      governorate: { type: 'string' },
      cattleProductionType: { type: 'string', enum: ['DAIRY', 'BEEF', 'BREEDING', 'MIXED', 'OTHER'] },
      description: { type: 'string', nullable: true },
      address: { type: 'string', nullable: true },
      capacity: { type: 'integer', minimum: 0, nullable: true },
      currentCattleCount: { type: 'integer', minimum: 0, nullable: true },
      contactName: { type: 'string', nullable: true },
      contactPhone: { type: 'string', nullable: true },
      contactEmail: { type: 'string', nullable: true },
    },
  },
  CattleBatch: {
    type: 'object',
    properties: {
      id: uuid,
      organizationId: uuid,
      name: { type: 'string' },
      breed: { type: 'string', nullable: true },
      headCount: { type: 'integer' },
      calfCount: { type: 'integer', nullable: true },
      bullCount: { type: 'integer', nullable: true },
      cowCount: { type: 'integer', nullable: true },
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
  CreateCattleBatchRequest: {
    type: 'object',
    required: ['name', 'headCount', 'arrivalDate'],
    properties: {
      name: { type: 'string' },
      breed: { type: 'string', nullable: true },
      headCount: { type: 'integer', minimum: 0 },
      calfCount: { type: 'integer', minimum: 0, nullable: true },
      bullCount: { type: 'integer', minimum: 0, nullable: true },
      cowCount: { type: 'integer', minimum: 0, nullable: true },
      arrivalDate: dateStr,
      notes: { type: 'string', nullable: true },
      initialHeadCount: { type: 'integer', minimum: 0, nullable: true },
      averageWeightKg: { type: 'number', minimum: 0, nullable: true },
      targetPricePerKg: { type: 'number', minimum: 0, nullable: true },
      expectedSaleDate: { ...dateStr, nullable: true },
    },
  },
  CattleBatchSummary: {
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
  CattleWeeklySummary: {
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
  CattleDailyRecord: {
    type: 'object',
    properties: {
      id: uuid,
      cattleBatchId: uuid,
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
  CreateCattleDailyRecordRequest: {
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
  CattleHealthEvent: {
    type: 'object',
    properties: {
      id: uuid,
      cattleBatchId: uuid,
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
  CattleCase: {
    type: 'object',
    properties: {
      id: uuid,
      cattleBatchId: uuid,
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
  CattleCaseSummary: {
    type: 'object',
    properties: {
      deceased: { type: 'integer' },
      recovered: { type: 'integer' },
      underTreatment: { type: 'integer' },
    },
  },
};

const T = ['Cattle Farms'];

const paths: Obj = {
  '/organizations/cattle-farms': {
    post: {
      tags: T,
      summary: 'Add Cattle Farm — creates a FARM organization (species=SHEEP), PENDING approval',
      security: bearer,
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateCattleFarmRequest' } } },
      },
      responses: { 201: ok('Created'), ...errs(400, 401, 422) },
    },
  },
  '/organizations/{organizationId}/cattle/batches': {
    parameters: [orgIdParam],
    get: {
      tags: T,
      summary: 'List cattle batches — farm.cattle_batch.read',
      security: bearer,
      parameters: [...pageParams, { name: 'status', in: 'query', schema: { type: 'string', enum: ['ACTIVE', 'CLOSED'] } }],
      responses: { 200: ok('Batches', listOf('#/components/schemas/CattleBatch')), ...errs(400, 401, 403, 404) },
    },
    post: {
      tags: T,
      summary: 'Register a cattle batch — farm.cattle_batch.create',
      security: bearer,
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateCattleBatchRequest' } } },
      },
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/CattleBatch' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/organizations/{organizationId}/cattle/batches/{batchId}': {
    parameters: [orgIdParam, batchIdParam],
    get: {
      tags: T,
      summary: 'Get a cattle batch — farm.cattle_batch.read',
      security: bearer,
      responses: { 200: ok('Batch', dataOf({ $ref: '#/components/schemas/CattleBatch' })), ...errs(401, 403, 404) },
    },
    patch: {
      tags: T,
      summary: 'Update a cattle batch — farm.cattle_batch.update',
      security: bearer,
      responses: {
        200: ok('Updated', dataOf({ $ref: '#/components/schemas/CattleBatch' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
    delete: {
      tags: T,
      summary: 'Delete a cattle batch — farm.cattle_batch.delete',
      security: bearer,
      responses: { 200: ok('Deleted'), ...errs(401, 403, 404) },
    },
  },
  '/organizations/{organizationId}/cattle/batches/{batchId}/summary': {
    parameters: [orgIdParam, batchIdParam],
    get: {
      tags: T,
      summary: 'Batch summary (server-computed) — farm.cattle_batch.read',
      security: bearer,
      responses: {
        200: ok('Batch summary', dataOf({ $ref: '#/components/schemas/CattleBatchSummary' })),
        ...errs(400, 401, 403, 404),
      },
    },
  },
  '/organizations/{organizationId}/cattle/batches/{batchId}/weekly-summary': {
    parameters: [orgIdParam, batchIdParam, { name: 'weekOf', in: 'query', schema: dateStr }],
    get: {
      tags: T,
      summary: 'Weekly summary (server-computed) — farm.cattle_batch.read',
      security: bearer,
      responses: {
        200: ok('Weekly summary', dataOf({ $ref: '#/components/schemas/CattleWeeklySummary' })),
        ...errs(400, 401, 403, 404),
      },
    },
  },
  '/organizations/{organizationId}/cattle/batches/{batchId}/daily-records': {
    parameters: [orgIdParam, batchIdParam],
    get: {
      tags: T,
      summary: 'List daily records — farm.daily_record.read',
      security: bearer,
      parameters: [...pageParams, { name: 'from', in: 'query', schema: dateStr }, { name: 'to', in: 'query', schema: dateStr }],
      responses: {
        200: ok('Daily records', listOf('#/components/schemas/CattleDailyRecord')),
        ...errs(400, 401, 403, 404),
      },
    },
    post: {
      tags: T,
      summary: 'Add a daily record — farm.daily_record.create',
      security: bearer,
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateCattleDailyRecordRequest' } } },
      },
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/CattleDailyRecord' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
  },
  '/organizations/{organizationId}/cattle/batches/{batchId}/daily-records/{recordId}': {
    parameters: [orgIdParam, batchIdParam, { name: 'recordId', in: 'path', required: true, schema: uuid }],
    get: {
      tags: T,
      summary: 'Get a daily record — farm.daily_record.read',
      security: bearer,
      responses: { 200: ok('Daily record', dataOf({ $ref: '#/components/schemas/CattleDailyRecord' })), ...errs(401, 403, 404) },
    },
    patch: {
      tags: T,
      summary: 'Update a daily record — farm.daily_record.update',
      security: bearer,
      responses: {
        200: ok('Updated', dataOf({ $ref: '#/components/schemas/CattleDailyRecord' })),
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
  '/organizations/{organizationId}/cattle/batches/{batchId}/health-events': {
    parameters: [orgIdParam, batchIdParam],
    get: {
      tags: T,
      summary: 'List treatments & vaccinations — farm.health_event.read',
      security: bearer,
      parameters: [...pageParams, { name: 'kind', in: 'query', schema: { type: 'string', enum: ['TREATMENT', 'VACCINATION'] } }],
      responses: {
        200: ok('Health events', listOf('#/components/schemas/CattleHealthEvent')),
        ...errs(400, 401, 403, 404),
      },
    },
    post: {
      tags: T,
      summary: 'Record a treatment or vaccination — farm.health_event.create',
      security: bearer,
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/CattleHealthEvent' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/organizations/{organizationId}/cattle/batches/{batchId}/cases': {
    parameters: [orgIdParam, batchIdParam],
    get: {
      tags: T,
      summary: 'List individual cases — farm.case.read',
      security: bearer,
      parameters: [...pageParams, { name: 'status', in: 'query', schema: { type: 'string', enum: ['UNDER_TREATMENT', 'RECOVERED', 'DECEASED'] } }],
      responses: { 200: ok('Cases', listOf('#/components/schemas/CattleCase')), ...errs(400, 401, 403, 404) },
    },
    post: {
      tags: T,
      summary: 'Open an individual case — farm.case.create',
      security: bearer,
      responses: {
        201: ok('Created', dataOf({ $ref: '#/components/schemas/CattleCase' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/organizations/{organizationId}/cattle/batches/{batchId}/cases/summary': {
    parameters: [orgIdParam, batchIdParam],
    get: {
      tags: T,
      summary: 'Case stat chips — farm.case.read',
      security: bearer,
      responses: { 200: ok('Summary', dataOf({ $ref: '#/components/schemas/CattleCaseSummary' })), ...errs(400, 401, 403, 404) },
    },
  },
};

export const cattleOpsOpenApi = { tags, paths, schemas };
