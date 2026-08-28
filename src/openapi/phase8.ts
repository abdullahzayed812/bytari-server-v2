/**
 * OpenAPI fragments for Phase 8 (Veterinary Medical Care).
 *
 * Medical Records, Vaccinations, Diagnoses (a `medical_records` field),
 * Treatments (a `medical_records` field) and the clinic ↔ veterinarian ↔ animal
 * authorization model were delivered in **Phase 5** and are documented there —
 * Phase 8 changes none of it. Phase 8 adds only the **Medical History** read
 * model: one chronological timeline that composes the existing
 * `medical_records` + `vaccinations` data (no new table, no duplication).
 *
 * Follow-ups are NOT in the confirmed product specification (see docs 04 §4.4 /
 * §4.25 and docs 05 UC-016/UC-017) and were deliberately not implemented.
 */

type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    401: 'Missing or invalid access token',
    403: 'Authenticated but lacks the organization permission (or organization not ACTIVE)',
    404: 'Animal not found, or not visible to the caller (no veterinary-access grant / not the owner)',
    422: 'Request failed validation',
  };
  const out: Obj = {};
  for (const c of codes) out[String(c)] = { description: map[c] ?? 'Error', content: jsonError };
  return out;
}

function ok(description: string, schema?: Obj): Obj {
  return schema ? { description, content: { 'application/json': { schema } } } : { description };
}

const uuid = { type: 'string', format: 'uuid' };
const orgIdParam = { name: 'organizationId', in: 'path', required: true, schema: uuid };
const animalIdParam = { name: 'animalId', in: 'path', required: true, schema: uuid };
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
  {
    name: 'type',
    in: 'query',
    schema: { type: 'string', enum: ['MEDICAL_RECORD', 'VACCINATION'] },
    description: 'Optional — restrict the timeline to one entry kind',
  },
];

const schemas: Obj = {
  MedicalTimelineEntry: {
    type: 'object',
    description:
      'One entry in the composed medical history. Exactly one of `medicalRecord` / `vaccination` is present, matching `type`.',
    properties: {
      type: { type: 'string', enum: ['MEDICAL_RECORD', 'VACCINATION'] },
      occurredOn: {
        type: 'string',
        format: 'date',
        description: 'visitDate (record) or administeredOn (vaccination)',
      },
      organizationId: uuid,
      recordedByUserId: { type: 'string', format: 'uuid', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      medicalRecord: { $ref: '#/components/schemas/MedicalRecord' },
      vaccination: { $ref: '#/components/schemas/Vaccination' },
    },
  },
};

const timelineList = {
  type: 'object',
  properties: {
    data: { type: 'array', items: { $ref: '#/components/schemas/MedicalTimelineEntry' } },
    meta: { type: 'object' },
  },
};

const paths: Obj = {
  '/organizations/{organizationId}/animals/{animalId}/medical-history': {
    get: {
      tags: ['Veterinary Care · Medical Records'],
      summary: 'Composed medical history timeline (records + vaccinations), newest first',
      description:
        'Requires `medical_record.read` in the clinic **and** an ACTIVE veterinary-access grant ' +
        'for the animal (same gate as the medical-records list). Read-only, paginated, no audit. ' +
        'A clinic with a grant sees the animal’s COMPLETE cross-clinic history.',
      security: bearer,
      parameters: [orgIdParam, animalIdParam, ...pageParams],
      responses: {
        '200': ok('Paginated timeline entries', timelineList),
        ...errs(401, 403, 404, 422),
      },
    },
  },
  '/animals/{animalId}/medical-history': {
    get: {
      tags: ['Animals · Medical History (owner)'],
      summary: 'The owner reads their animal’s composed medical history timeline',
      description: 'Current owner or ADMIN only. Read-only, paginated.',
      security: bearer,
      parameters: [animalIdParam, ...pageParams],
      responses: {
        '200': ok('Paginated timeline entries', timelineList),
        ...errs(401, 404, 422),
      },
    },
  },
};

/** No new tags — reuses the Phase 5 medical tags. */
const tags: { name: string; description?: string }[] = [];

export const phase8OpenApi = { tags, paths, schemas };
