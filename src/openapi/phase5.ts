/**
 * OpenAPI fragments for Phase 5 (Veterinary Care & Medical Records). Merged into
 * the base document by `buildOpenApiDocument`.
 *
 * Authorization for a clinic-facing route:
 *   authenticate → withOrganization → authorizeOrg(<org permission>)
 *                → veterinary-access gate (the clinic must hold an ACTIVE
 *                  `animal_clinic_access` grant for the animal; ADMIN bypasses).
 *
 * A clinic with an active grant reads the animal's COMPLETE medical /
 * vaccination history (every clinic's entries); it may create / update / delete
 * only entries it recorded itself. Owner-facing routes are read-only and reuse
 * the Phase 4 ownership guard (current owner or ADMIN).
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
    404: 'Not found, or not visible to the caller (no veterinary-access grant / not the owner)',
    409: 'Conflict with current state (animal deactivated, access already granted, concurrent change)',
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
  ClinicAnimalAccess: {
    type: 'object',
    properties: {
      id: uuid,
      animalId: uuid,
      organizationId: uuid,
      status: { type: 'string', enum: ['ACTIVE', 'REVOKED'] },
      grantedByUserId: { type: 'string', format: 'uuid', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
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
  GrantVeterinaryAccessRequest: {
    type: 'object',
    required: ['animalId'],
    properties: { animalId: uuid },
  },
};

const recordsBase = '/organizations/{organizationId}/animals/{animalId}/medical-records';
const vaxBase = '/organizations/{organizationId}/animals/{animalId}/vaccinations';

const paths: Obj = {
  '/organizations/{organizationId}/animal-access': {
    get: {
      tags: ['Veterinary Care · Access'],
      summary: 'List the animals this clinic has veterinary access to',
      description: 'Requires `animal.veterinary.access.read` in the clinic.',
      security: bearer,
      parameters: [orgIdParam, ...pageParams],
      responses: {
        '200': ok('Paginated access grants', listOf('#/components/schemas/ClinicAnimalAccess')),
        ...errs(401, 403),
      },
    },
    post: {
      tags: ['Veterinary Care · Access'],
      summary: 'Grant this clinic veterinary access to an animal',
      description:
        'Requires `animal.veterinary.access.manage` (clinic OWNER / empowered SUPERVISOR by ' +
        'default — NOT the plain VETERINARIAN role). The organization must be a CLINIC. ' +
        'Independent of animal ownership; revocable; audited.',
      security: bearer,
      parameters: [orgIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/GrantVeterinaryAccessRequest' },
          },
        },
      },
      responses: {
        '201': ok('Access granted', dataOf({ $ref: '#/components/schemas/ClinicAnimalAccess' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
  },
  '/organizations/{organizationId}/animal-access/{animalId}': {
    delete: {
      tags: ['Veterinary Care · Access'],
      summary: 'Revoke this clinic’s veterinary access to an animal',
      description: 'Requires `animal.veterinary.access.manage`. Medical history is NOT deleted.',
      security: bearer,
      parameters: [orgIdParam, animalIdParam],
      responses: { '200': ok('Access revoked'), ...errs(401, 403, 404) },
    },
  },

  [recordsBase]: {
    get: {
      tags: ['Veterinary Care · Medical Records'],
      summary: 'List an animal’s medical history (complete — all clinics)',
      description: 'Requires `medical_record.read` + an ACTIVE veterinary-access grant.',
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
        'Requires `medical_record.create` + veterinary access. The animal must be ACTIVE. ' +
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
      summary: 'Get one medical record',
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
      summary: 'List an animal’s vaccination history (complete — all clinics)',
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
      summary: 'Get one vaccination',
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
  '/animals/{animalId}/medical-records': {
    get: {
      tags: ['Animals · Medical History (owner)'],
      summary: 'The owner reads their animal’s complete medical history',
      description: 'Current owner or ADMIN only. Read-only.',
      security: bearer,
      parameters: [animalIdParam, ...pageParams],
      responses: {
        '200': ok('Paginated medical records', listOf('#/components/schemas/MedicalRecord')),
        ...errs(401, 404),
      },
    },
  },
  '/animals/{animalId}/medical-records/{recordId}': {
    get: {
      tags: ['Animals · Medical History (owner)'],
      summary: 'The owner reads one medical record',
      security: bearer,
      parameters: [animalIdParam, recordIdParam],
      responses: {
        '200': ok('Medical record', dataOf({ $ref: '#/components/schemas/MedicalRecord' })),
        ...errs(401, 404),
      },
    },
  },
  '/animals/{animalId}/vaccinations': {
    get: {
      tags: ['Animals · Medical History (owner)'],
      summary: 'The owner reads their animal’s complete vaccination history',
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

const tags = [
  { name: 'Veterinary Care · Access', description: 'CLINIC ↔ animal veterinary-access grants' },
  {
    name: 'Veterinary Care · Medical Records',
    description: 'Clinic-facing medical record CRUD (veterinary-access gated)',
  },
  {
    name: 'Veterinary Care · Vaccinations',
    description: 'Clinic-facing vaccination CRUD (veterinary-access gated)',
  },
  {
    name: 'Animals · Medical History (owner)',
    description: 'Owner-facing read-only veterinary history',
  },
];

export const phase5OpenApi = { tags, paths, schemas };
