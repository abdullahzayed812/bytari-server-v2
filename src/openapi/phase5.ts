/**
 * OpenAPI fragments for Phase 5 (Veterinary Care & Medical Records). Merged into
 * the base document by `buildOpenApiDocument`.
 *
 * Authorization for a clinic-facing route:
 *   authenticate → withOrganization → authorizeOrg(<org permission>)
 *                → operability guard → registered pet (no clinic ↔ pet link).
 *
 * CLINIC ISOLATION: a clinic reads, updates and deletes ONLY the entries it
 * created (`organization_id`); another clinic's entry is the same 404 as an
 * unknown id. Its Recent / All Pets are the pets it has entries for.
 * Owner-facing routes are read-only, reuse the Phase 4 ownership guard
 * (current owner or ADMIN) and expose only the owner-visible kinds:
 * vaccinations and reminders. Medical records have no owner route.
 */

type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request (e.g. organization is not a CLINIC)',
    401: 'Missing or invalid access token',
    403: 'Authenticated but lacks the organization permission (or organization not ACTIVE)',
    404: 'Not found, or not visible to the caller (another clinic’s entry / not the owner)',
    409: 'Conflict with current state (animal deactivated, concurrent change)',
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
    properties: {
      data: { type: 'array', items: { $ref: ref } },
      meta: { type: 'object' },
    },
  };
}

const uuid = { type: 'string', format: 'uuid' };
const orgIdParam = { name: 'organizationId', in: 'path', required: true, schema: uuid };
const animalIdParam = { name: 'animalId', in: 'path', required: true, schema: uuid };
const recordIdParam = { name: 'recordId', in: 'path', required: true, schema: uuid };
const vaccinationIdParam = { name: 'vaccinationId', in: 'path', required: true, schema: uuid };
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
];

const schemas: Obj = {
  MedicalRecord: {
    type: 'object',
    properties: {
      id: uuid,
      animalId: uuid,
      organizationId: uuid,
      recordedByUserId: { type: 'string', format: 'uuid', nullable: true },
      visitDate: { type: 'string', format: 'date' },
      reason: { type: 'string', nullable: true },
      diagnosis: { type: 'string', nullable: true },
      treatment: { type: 'string', nullable: true },
      notes: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  Vaccination: {
    type: 'object',
    properties: {
      id: uuid,
      animalId: uuid,
      organizationId: uuid,
      recordedByUserId: { type: 'string', format: 'uuid', nullable: true },
      vaccineName: { type: 'string' },
      administeredOn: { type: 'string', format: 'date' },
      nextDueOn: { type: 'string', format: 'date', nullable: true },
      notes: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  ClinicPet: {
    type: 'object',
    description: 'A pet this clinic has its own records for (derived — no link row).',
    properties: {
      animalId: uuid,
      publicCode: { type: 'string', example: 'K7M4QXR', description: 'Short public pet ID' },
      animal: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          species: { type: 'string' },
          status: { type: 'string' },
          breed: { type: 'string', nullable: true },
          photoUrl: { type: 'string', nullable: true },
        },
      },
      ownerName: { type: 'string', nullable: true },
      firstActivityAt: { type: 'string', format: 'date-time' },
      lastActivityAt: { type: 'string', format: 'date-time' },
    },
  },
  ClinicPetLookup: {
    type: 'object',
    properties: {
      animalId: uuid,
      publicCode: { type: 'string' },
      name: { type: 'string' },
      species: { type: 'string' },
      breed: { type: 'string', nullable: true },
      photoUrl: { type: 'string', nullable: true },
      workedWith: { type: 'boolean', description: 'This clinic already has its own records' },
    },
  },
  CreateMedicalRecordRequest: {
    type: 'object',
    description: 'At least one of reason / diagnosis / treatment / notes is required.',
    properties: {
      visitDate: { type: 'string', format: 'date', description: 'YYYY-MM-DD, not in the future' },
      reason: { type: 'string', maxLength: 2000, nullable: true },
      diagnosis: { type: 'string', maxLength: 8000, nullable: true },
      treatment: { type: 'string', maxLength: 8000, nullable: true },
      notes: { type: 'string', maxLength: 8000, nullable: true },
    },
  },
  UpdateMedicalRecordRequest: {
    type: 'object',
    minProperties: 1,
    properties: {
      visitDate: { type: 'string', format: 'date' },
      reason: { type: 'string', nullable: true },
      diagnosis: { type: 'string', nullable: true },
      treatment: { type: 'string', nullable: true },
      notes: { type: 'string', nullable: true },
    },
  },
  CreateVaccinationRequest: {
    type: 'object',
    required: ['vaccineName', 'administeredOn'],
    properties: {
      vaccineName: { type: 'string', minLength: 1, maxLength: 200 },
      administeredOn: {
        type: 'string',
        format: 'date',
        description: 'YYYY-MM-DD, not in the future',
      },
      nextDueOn: {
        type: 'string',
        format: 'date',
        nullable: true,
        description: 'Must be on/after administeredOn',
      },
      notes: { type: 'string', maxLength: 8000, nullable: true },
    },
  },
  UpdateVaccinationRequest: {
    type: 'object',
    minProperties: 1,
    properties: {
      vaccineName: { type: 'string', minLength: 1, maxLength: 200 },
      administeredOn: { type: 'string', format: 'date' },
      nextDueOn: { type: 'string', format: 'date', nullable: true },
      notes: { type: 'string', nullable: true },
    },
  },
};

const recordsBase = '/organizations/{organizationId}/animals/{animalId}/medical-records';
const vaxBase = '/organizations/{organizationId}/animals/{animalId}/vaccinations';

const paths: Obj = {
  '/organizations/{organizationId}/clinic-pets': {
    get: {
      tags: ['Veterinary Care · Clinic Pets'],
      summary: 'Recent / All Pets — pets this clinic has its own records for',
      description:
        'Requires `animal.veterinary.access.read`. Derived from THIS clinic’s medical records, ' +
        'vaccinations and reminders; newest activity first. `search` matches the full id or ' +
        'short public ID exactly, or name / breed / species / owner name / phone.',
      security: bearer,
      parameters: [
        orgIdParam,
        ...pageParams,
        { name: 'search', in: 'query', schema: { type: 'string', maxLength: 100 } },
      ],
      responses: {
        '200': ok('Paginated clinic pets', listOf('#/components/schemas/ClinicPet')),
        ...errs(400, 401, 403),
      },
    },
  },
  '/organizations/{organizationId}/clinic-pets/lookup': {
    get: {
      tags: ['Veterinary Care · Clinic Pets'],
      summary: 'Open a pet by its short public ID or scanned QR',
      description:
        'Requires `animal.veterinary.access.read`. Accepts the short public ID (any case, ' +
        'dash optional) or a legacy UUID / link. Creates no relationship; rate-limited and ' +
        'audited. Unknown codes and listing-only animals are the same 404.',
      security: bearer,
      parameters: [
        orgIdParam,
        { name: 'code', in: 'query', required: true, schema: { type: 'string', maxLength: 300 } },
      ],
      responses: {
        '200': ok('Pet summary', dataOf({ $ref: '#/components/schemas/ClinicPetLookup' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },

  [recordsBase]: {
    get: {
      tags: ['Veterinary Care · Medical Records'],
      summary: 'List the medical records THIS clinic created for the animal',
      description: 'Requires `medical_record.read`. Other clinics’ records are never returned.',
      security: bearer,
      parameters: [orgIdParam, animalIdParam, ...pageParams],
      responses: {
        '200': ok('Paginated medical records', listOf('#/components/schemas/MedicalRecord')),
        ...errs(401, 403, 404),
      },
    },
    post: {
      tags: ['Veterinary Care · Medical Records'],
      summary: 'Add a medical record for the animal',
      description:
        'Requires `medical_record.create`. The animal must be ACTIVE. Clinic-private: never ' +
        'shown to the owner or to another clinic. ' +
        'The recording user and clinic are taken from the server, never the body.',
      security: bearer,
      parameters: [orgIdParam, animalIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateMedicalRecordRequest' },
          },
        },
      },
      responses: {
        '201': ok('Created', dataOf({ $ref: '#/components/schemas/MedicalRecord' })),
        ...errs(401, 403, 404, 409, 422),
      },
    },
  },
  [`${recordsBase}/{recordId}`]: {
    get: {
      tags: ['Veterinary Care · Medical Records'],
      summary: 'Get one medical record created by THIS clinic',
      description: 'Requires `medical_record.read` + veterinary access.',
      security: bearer,
      parameters: [orgIdParam, animalIdParam, recordIdParam],
      responses: {
        '200': ok('Medical record', dataOf({ $ref: '#/components/schemas/MedicalRecord' })),
        ...errs(401, 403, 404),
      },
    },
    patch: {
      tags: ['Veterinary Care · Medical Records'],
      summary: 'Update a medical record recorded by THIS clinic',
      description:
        'Requires `medical_record.update` + veterinary access. Records recorded by another ' +
        'clinic return 404. The animal must be ACTIVE.',
      security: bearer,
      parameters: [orgIdParam, animalIdParam, recordIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UpdateMedicalRecordRequest' },
          },
        },
      },
      responses: {
        '200': ok('Updated', dataOf({ $ref: '#/components/schemas/MedicalRecord' })),
        ...errs(401, 403, 404, 409, 422),
      },
    },
    delete: {
      tags: ['Veterinary Care · Medical Records'],
      summary: 'Delete a medical record recorded by THIS clinic',
      description:
        'Requires `medical_record.delete` + veterinary access. Records recorded by another ' +
        'clinic return 404. The deletion is audited.',
      security: bearer,
      parameters: [orgIdParam, animalIdParam, recordIdParam],
      responses: { '200': ok('Deleted'), ...errs(401, 403, 404) },
    },
  },

  [vaxBase]: {
    get: {
      tags: ['Veterinary Care · Vaccinations'],
      summary: 'List the vaccinations THIS clinic recorded for the animal',
      description:
        'Requires `vaccination.read` + veterinary access. `dueFrom=YYYY-MM-DD` filters to ' +
        'upcoming/future due dates.',
      security: bearer,
      parameters: [
        orgIdParam,
        animalIdParam,
        ...pageParams,
        { name: 'dueFrom', in: 'query', schema: { type: 'string', format: 'date' } },
      ],
      responses: {
        '200': ok('Paginated vaccinations', listOf('#/components/schemas/Vaccination')),
        ...errs(401, 403, 404),
      },
    },
    post: {
      tags: ['Veterinary Care · Vaccinations'],
      summary: 'Add a vaccination for the animal',
      description: 'Requires `vaccination.create` + veterinary access. The animal must be ACTIVE.',
      security: bearer,
      parameters: [orgIdParam, animalIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/CreateVaccinationRequest' } },
        },
      },
      responses: {
        '201': ok('Created', dataOf({ $ref: '#/components/schemas/Vaccination' })),
        ...errs(401, 403, 404, 409, 422),
      },
    },
  },
  [`${vaxBase}/{vaccinationId}`]: {
    get: {
      tags: ['Veterinary Care · Vaccinations'],
      summary: 'Get one vaccination recorded by THIS clinic',
      security: bearer,
      parameters: [orgIdParam, animalIdParam, vaccinationIdParam],
      responses: {
        '200': ok('Vaccination', dataOf({ $ref: '#/components/schemas/Vaccination' })),
        ...errs(401, 403, 404),
      },
    },
    patch: {
      tags: ['Veterinary Care · Vaccinations'],
      summary: 'Update a vaccination recorded by THIS clinic',
      security: bearer,
      parameters: [orgIdParam, animalIdParam, vaccinationIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/UpdateVaccinationRequest' } },
        },
      },
      responses: {
        '200': ok('Updated', dataOf({ $ref: '#/components/schemas/Vaccination' })),
        ...errs(401, 403, 404, 409, 422),
      },
    },
    delete: {
      tags: ['Veterinary Care · Vaccinations'],
      summary: 'Delete a vaccination recorded by THIS clinic',
      security: bearer,
      parameters: [orgIdParam, animalIdParam, vaccinationIdParam],
      responses: { '200': ok('Deleted'), ...errs(401, 403, 404) },
    },
  },

  // --- owner-facing (read-only) ------------------------------------
  '/animals/{animalId}/vaccinations': {
    get: {
      tags: ['Animals · Medical History (owner)'],
      summary: 'The owner reads every clinic’s vaccinations for their animal (read-only)',
      security: bearer,
      parameters: [
        animalIdParam,
        ...pageParams,
        { name: 'dueFrom', in: 'query', schema: { type: 'string', format: 'date' } },
      ],
      responses: {
        '200': ok('Paginated vaccinations', listOf('#/components/schemas/Vaccination')),
        ...errs(401, 404),
      },
    },
  },
  '/animals/{animalId}/vaccinations/{vaccinationId}': {
    get: {
      tags: ['Animals · Medical History (owner)'],
      summary: 'The owner reads one vaccination',
      security: bearer,
      parameters: [animalIdParam, vaccinationIdParam],
      responses: {
        '200': ok('Vaccination', dataOf({ $ref: '#/components/schemas/Vaccination' })),
        ...errs(401, 404),
      },
    },
  },
};

// --- Clinic Dashboard -----------------------------------------------
Object.assign(paths, {
  '/organizations/{organizationId}/clinic-dashboard/summary': {
    get: {
      tags: ['Veterinary Care · Clinic Dashboard'],
      summary: 'Clinic Dashboard stats + the caller’s effective clinic permissions',
      description:
        'Requires `organization.read` in a CLINIC. `animals` / `medical` / `appointments` are ' +
        '`null` unless the caller holds `animal.veterinary.access.read` / `medical_record.read` / ' +
        '`clinic.appointment.read`. `permissions` is derived from org RBAC (owner / ADMIN override).',
      security: bearer,
      parameters: [orgIdParam],
      responses: {
        '200': ok('Dashboard summary', dataOf({ type: 'object' })),
        ...errs(400, 401, 403),
      },
    },
  },
  '/organizations/{organizationId}/animals/{animalId}': {
    get: {
      tags: ['Veterinary Care · Clinic Dashboard'],
      summary: 'The clinic-visible profile of a pet (stats over THIS clinic’s records only)',
      description:
        'Requires `animal.veterinary.access.read`; 404 for unknown / listing-only animals. ' +
        'Carries the short `publicCode`, the current owner’s contact, and `relationship` / ' +
        '`stats` computed over THIS clinic’s own records only. Never the owner’s private ' +
        'notes or storage keys.',
      security: bearer,
      parameters: [orgIdParam, animalIdParam],
      responses: {
        '200': ok('Clinic animal profile', dataOf({ type: 'object' })),
        ...errs(400, 401, 403, 404),
      },
    },
  },
});

const tags = [
  {
    name: 'Veterinary Care · Clinic Pets',
    description: 'Record-derived clinic pets (Recent / All) and open-by-short-ID',
  },
  {
    name: 'Veterinary Care · Medical Records',
    description: 'Clinic-facing medical record CRUD (clinic-private, per-clinic isolation)',
  },
  {
    name: 'Veterinary Care · Vaccinations',
    description: 'Clinic-facing vaccination CRUD (veterinary-access gated)',
  },
  {
    name: 'Veterinary Care · Clinic Dashboard',
    description: 'Clinic Dashboard summary + clinic-visible animal profile',
  },
  {
    name: 'Animals · Medical History (owner)',
    description: 'Owner-facing read-only veterinary history',
  },
];

export const phase5OpenApi = { tags, paths, schemas };
