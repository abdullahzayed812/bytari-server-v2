/**
 * OpenAPI fragments for Veterinarian Jobs / Careers ("الوظائف البيطرية").
 * Employer-posted job offers + veterinarian "looking for a job" profiles
 * (both moderated PENDING → APPROVED/REJECTED), applications (decided by the
 * offer's poster), and on-accept chat (reuses the existing
 * PET_OWNER_VETERINARIAN conversation seam — see `chat.ts`).
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
    403: 'Authenticated but lacks the required permission / veterinarian approval',
    404: 'Resource not found (or not APPROVED for a public read; not a party to it)',
    409: 'Conflict (already applied, not open for applications, already reviewed)',
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
const money = { type: 'string', description: 'Decimal string, numeric(12,2). Never a float.' };
const userSummary = {
  type: 'object',
  properties: { id: uuid, firstName: { type: 'string' }, lastName: { type: 'string' } },
};
const employmentType = {
  type: 'string',
  enum: ['FULL_TIME', 'PART_TIME', 'SHIFT', 'EVENING', 'OTHER'],
};

const tags = [
  { name: 'Veterinarian Jobs', description: 'Job offers, job-seeker profiles, applications.' },
  { name: 'Veterinarian Jobs (Admin)', description: 'Offer / seeker-profile moderation (vet_job.*).' },
];

const schemas: Obj = {
  VetJobOffer: {
    type: 'object',
    properties: {
      id: uuid,
      postedByUserId: uuid,
      postedBy: userSummary,
      organizationId: { ...uuid, nullable: true },
      organizationName: { type: 'string' },
      title: { type: 'string' },
      employmentType,
      governorate: { type: 'string' },
      district: { type: 'string', nullable: true },
      salaryAmount: { ...money, nullable: true },
      salaryNegotiable: { type: 'boolean' },
      experienceYearsRequired: { type: 'integer', nullable: true },
      qualifications: { type: 'string', nullable: true },
      description: { type: 'string' },
      responsibilities: { type: 'array', items: { type: 'string' } },
      requirements: { type: 'array', items: { type: 'string' } },
      benefits: { type: 'array', items: { type: 'string' } },
      contactPhone: { type: 'string' },
      contactEmail: { type: 'string', nullable: true },
      applicationDeadline: { type: 'string', format: 'date', nullable: true },
      status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
      rejectionReason: { type: 'string', nullable: true },
      closedAt: { type: 'string', format: 'date-time', nullable: true },
      applicationCount: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  PublicVetJobOffer: {
    type: 'object',
    properties: {
      id: uuid,
      organizationName: { type: 'string' },
      title: { type: 'string' },
      employmentType,
      governorate: { type: 'string' },
      district: { type: 'string', nullable: true },
      salaryAmount: { ...money, nullable: true },
      salaryNegotiable: { type: 'boolean' },
      experienceYearsRequired: { type: 'integer', nullable: true },
      qualifications: { type: 'string', nullable: true },
      description: { type: 'string' },
      responsibilities: { type: 'array', items: { type: 'string' } },
      requirements: { type: 'array', items: { type: 'string' } },
      benefits: { type: 'array', items: { type: 'string' } },
      contactPhone: { type: 'string' },
      contactEmail: { type: 'string', nullable: true },
      applicationDeadline: { type: 'string', format: 'date', nullable: true },
      publishedAt: { type: 'string', format: 'date-time' },
    },
  },
  VetJobSeekerProfile: {
    type: 'object',
    properties: {
      id: uuid,
      user: userSummary,
      specialty: { type: 'string' },
      headline: { type: 'string', nullable: true },
      experienceYears: { type: 'integer' },
      governorate: { type: 'string' },
      district: { type: 'string', nullable: true },
      qualifications: { type: 'string', nullable: true },
      skills: { type: 'array', items: { type: 'string' } },
      preferredEmploymentTypes: { type: 'array', items: employmentType },
      phone: { type: 'string' },
      email: { type: 'string', nullable: true },
      cvUrl: { type: 'string', nullable: true },
      photoUrl: { type: 'string', nullable: true },
      status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
      rejectionReason: { type: 'string', nullable: true },
      closedAt: { type: 'string', format: 'date-time', nullable: true },
    },
  },
  PublicVetJobSeekerProfile: {
    type: 'object',
    properties: {
      id: uuid,
      specialty: { type: 'string' },
      headline: { type: 'string', nullable: true },
      experienceYears: { type: 'integer' },
      governorate: { type: 'string' },
      district: { type: 'string', nullable: true },
      qualifications: { type: 'string', nullable: true },
      skills: { type: 'array', items: { type: 'string' } },
      preferredEmploymentTypes: { type: 'array', items: employmentType },
      photoUrl: { type: 'string', nullable: true },
      cvUrl: { type: 'string', nullable: true },
      user: userSummary,
      publishedAt: { type: 'string', format: 'date-time' },
    },
  },
  VetJobApplication: {
    type: 'object',
    properties: {
      id: uuid,
      jobOfferId: uuid,
      applicant: userSummary,
      fullName: { type: 'string' },
      phone: { type: 'string' },
      email: { type: 'string', nullable: true },
      specialty: { type: 'string', nullable: true },
      experienceYears: { type: 'integer', nullable: true },
      qualifications: { type: 'string', nullable: true },
      coverNote: { type: 'string', nullable: true },
      cvUrl: { type: 'string', nullable: true },
      photoUrl: { type: 'string', nullable: true },
      status: { type: 'string', enum: ['PENDING', 'ACCEPTED', 'REJECTED'] },
      conversationId: { ...uuid, nullable: true },
      offer: {
        type: 'object',
        nullable: true,
        properties: {
          id: uuid,
          title: { type: 'string' },
          organizationName: { type: 'string' },
          postedByUserId: uuid,
        },
      },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
};

const uploadUrlResult = dataOf({
  type: 'object',
  properties: {
    storageKey: { type: 'string' },
    uploadUrl: { type: 'string' },
    method: { type: 'string', enum: ['PUT'] },
    headers: { type: 'object' },
    expiresInSeconds: { type: 'integer' },
  },
});

const paths: Obj = {
  '/vet-jobs/attachments/upload-url': {
    post: {
      tags: ['Veterinarian Jobs'],
      summary: 'Request a presigned R2 upload URL for a CV (PDF) or photo',
      security: bearer,
      responses: { 201: ok('Upload URL', uploadUrlResult), ...errs(400, 401, 422) },
    },
  },
  '/vet-jobs/offers': {
    get: {
      tags: ['Veterinarian Jobs'],
      summary: 'Browse APPROVED, open job offers (search / employmentType / governorate)',
      security: bearer,
      responses: { 200: ok('Offers', listOf('#/components/schemas/PublicVetJobOffer')), ...errs(401) },
    },
    post: {
      tags: ['Veterinarian Jobs'],
      summary: 'Post a job offer (any authenticated user) — starts PENDING',
      security: bearer,
      responses: {
        201: ok('Offer', dataOf({ $ref: '#/components/schemas/VetJobOffer' })),
        ...errs(400, 401, 422),
      },
    },
  },
  '/vet-jobs/offers/mine': {
    get: {
      tags: ['Veterinarian Jobs'],
      summary: "The caller's own job offers (any status)",
      security: bearer,
      responses: { 200: ok('Offers', listOf('#/components/schemas/VetJobOffer')), ...errs(401) },
    },
  },
  '/vet-jobs/offers/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinarian Jobs'],
      summary: 'Offer detail (APPROVED + open only)',
      security: bearer,
      responses: {
        200: ok('Offer', dataOf({ $ref: '#/components/schemas/PublicVetJobOffer' })),
        ...errs(401, 404),
      },
    },
    patch: {
      tags: ['Veterinarian Jobs'],
      summary: 'Update the offer (owner only; a rejected offer resets to PENDING)',
      security: bearer,
      responses: {
        200: ok('Offer', dataOf({ $ref: '#/components/schemas/VetJobOffer' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
    delete: {
      tags: ['Veterinarian Jobs'],
      summary: 'Delete the offer (owner or moderator)',
      security: bearer,
      responses: { 204: ok('Deleted'), ...errs(401, 403, 404) },
    },
  },
  '/vet-jobs/offers/{id}/manage': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinarian Jobs'],
      summary: 'Owner / moderator full view (moderation metadata + application count)',
      security: bearer,
      responses: {
        200: ok('Offer', dataOf({ $ref: '#/components/schemas/VetJobOffer' })),
        ...errs(401, 404),
      },
    },
  },
  '/vet-jobs/offers/{id}/close': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Veterinarian Jobs'],
      summary: 'إلغاء الإعلان — the poster closes their own offer early',
      security: bearer,
      responses: {
        200: ok('Offer', dataOf({ $ref: '#/components/schemas/VetJobOffer' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/vet-jobs/offers/{id}/applications': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Veterinarian Jobs'],
      summary: 'التقديم على الوظيفة — apply to this offer (approved veterinarian only)',
      security: bearer,
      responses: {
        201: ok('Application', dataOf({ $ref: '#/components/schemas/VetJobApplication' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
    get: {
      tags: ['Veterinarian Jobs'],
      summary: 'Applicants to this offer (the offer poster only)',
      security: bearer,
      responses: {
        200: ok('Applications', listOf('#/components/schemas/VetJobApplication')),
        ...errs(401, 404),
      },
    },
  },
  '/vet-jobs/applications/received': {
    get: {
      tags: ['Veterinarian Jobs'],
      summary: "Applications received across ALL of the caller's job offers",
      security: bearer,
      responses: {
        200: ok('Applications', listOf('#/components/schemas/VetJobApplication')),
        ...errs(401),
      },
    },
  },
  '/vet-jobs/applications/mine': {
    get: {
      tags: ['Veterinarian Jobs'],
      summary: 'طلباتي — the caller\'s own submitted applications',
      security: bearer,
      responses: {
        200: ok('Applications', listOf('#/components/schemas/VetJobApplication')),
        ...errs(401),
      },
    },
  },
  '/vet-jobs/applications/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinarian Jobs'],
      summary: 'One application (the applicant or the offer poster only)',
      security: bearer,
      responses: {
        200: ok('Application', dataOf({ $ref: '#/components/schemas/VetJobApplication' })),
        ...errs(401, 404),
      },
    },
  },
  '/vet-jobs/applications/{id}/accept': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Veterinarian Jobs'],
      summary: 'Accept an application — creates + pins a chat conversation (offer poster only)',
      security: bearer,
      responses: {
        200: ok('Application', dataOf({ $ref: '#/components/schemas/VetJobApplication' })),
        ...errs(401, 404, 409),
      },
    },
  },
  '/vet-jobs/applications/{id}/reject': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Veterinarian Jobs'],
      summary: 'Reject an application (offer poster only)',
      security: bearer,
      responses: {
        200: ok('Application', dataOf({ $ref: '#/components/schemas/VetJobApplication' })),
        ...errs(401, 404, 409),
      },
    },
  },
  '/vet-jobs/seekers': {
    get: {
      tags: ['Veterinarian Jobs'],
      summary: 'باحثون عن عمل — browse APPROVED job-seeker profiles',
      security: bearer,
      responses: {
        200: ok('Profiles', listOf('#/components/schemas/PublicVetJobSeekerProfile')),
        ...errs(401),
      },
    },
    post: {
      tags: ['Veterinarian Jobs'],
      summary: 'Create the caller\'s own job-seeker profile (approved veterinarian only)',
      security: bearer,
      responses: {
        201: ok('Profile', dataOf({ $ref: '#/components/schemas/VetJobSeekerProfile' })),
        ...errs(400, 401, 403, 409, 422),
      },
    },
  },
  '/vet-jobs/seekers/mine': {
    get: {
      tags: ['Veterinarian Jobs'],
      summary: "The caller's own job-seeker profile, if any",
      security: bearer,
      responses: {
        200: ok('Profile', dataOf({ $ref: '#/components/schemas/VetJobSeekerProfile' })),
        ...errs(401),
      },
    },
    patch: {
      tags: ['Veterinarian Jobs'],
      summary: "Update the caller's own profile (a rejected profile resets to PENDING)",
      security: bearer,
      responses: {
        200: ok('Profile', dataOf({ $ref: '#/components/schemas/VetJobSeekerProfile' })),
        ...errs(400, 401, 404, 422),
      },
    },
  },
  '/vet-jobs/seekers/mine/deactivate': {
    post: {
      tags: ['Veterinarian Jobs'],
      summary: "Pause the caller's own approved profile",
      security: bearer,
      responses: {
        200: ok('Profile', dataOf({ $ref: '#/components/schemas/VetJobSeekerProfile' })),
        ...errs(401, 404),
      },
    },
  },
  '/vet-jobs/seekers/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinarian Jobs'],
      summary: 'Profile detail (تفاصيل الطبيب) — APPROVED only',
      security: bearer,
      responses: {
        200: ok('Profile', dataOf({ $ref: '#/components/schemas/PublicVetJobSeekerProfile' })),
        ...errs(401, 404),
      },
    },
  },
  '/vet-jobs/seekers/{id}/conversation': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Veterinarian Jobs'],
      summary: 'تواصل مع الطبيب — open a direct chat with this job-seeker',
      security: bearer,
      responses: {
        200: ok('Conversation', dataOf({ type: 'object', properties: { conversationId: uuid } })),
        ...errs(400, 401, 404),
      },
    },
  },

  // --- admin -----------------------------------------------
  '/admin/vet-job-offers': {
    get: {
      tags: ['Veterinarian Jobs (Admin)'],
      summary: 'List job offers for moderation — vet_job.read',
      security: bearer,
      responses: { 200: ok('Offers', listOf('#/components/schemas/VetJobOffer')), ...errs(401, 403) },
    },
  },
  '/admin/vet-job-offers/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinarian Jobs (Admin)'],
      summary: 'Offer moderation detail — vet_job.read',
      security: bearer,
      responses: {
        200: ok('Offer', dataOf({ $ref: '#/components/schemas/VetJobOffer' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/vet-job-offers/{id}/approve': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Veterinarian Jobs (Admin)'],
      summary: 'Approve a pending job offer — vet_job.approve',
      security: bearer,
      responses: {
        200: ok('Offer', dataOf({ $ref: '#/components/schemas/VetJobOffer' })),
        ...errs(401, 403, 404, 409),
      },
    },
  },
  '/admin/vet-job-offers/{id}/reject': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Veterinarian Jobs (Admin)'],
      summary: 'Reject a pending job offer — vet_job.reject',
      security: bearer,
      responses: {
        200: ok('Offer', dataOf({ $ref: '#/components/schemas/VetJobOffer' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
  },
  '/admin/vet-job-seekers': {
    get: {
      tags: ['Veterinarian Jobs (Admin)'],
      summary: 'List job-seeker profiles for moderation — vet_job.read',
      security: bearer,
      responses: {
        200: ok('Profiles', listOf('#/components/schemas/VetJobSeekerProfile')),
        ...errs(401, 403),
      },
    },
  },
  '/admin/vet-job-seekers/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinarian Jobs (Admin)'],
      summary: 'Profile moderation detail — vet_job.read',
      security: bearer,
      responses: {
        200: ok('Profile', dataOf({ $ref: '#/components/schemas/VetJobSeekerProfile' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/vet-job-seekers/{id}/approve': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Veterinarian Jobs (Admin)'],
      summary: 'Approve a pending job-seeker profile — vet_job.approve',
      security: bearer,
      responses: {
        200: ok('Profile', dataOf({ $ref: '#/components/schemas/VetJobSeekerProfile' })),
        ...errs(401, 403, 404, 409),
      },
    },
  },
  '/admin/vet-job-seekers/{id}/reject': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Veterinarian Jobs (Admin)'],
      summary: 'Reject a pending job-seeker profile — vet_job.reject',
      security: bearer,
      responses: {
        200: ok('Profile', dataOf({ $ref: '#/components/schemas/VetJobSeekerProfile' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
  },
  '/admin/vet-job-applications': {
    get: {
      tags: ['Veterinarian Jobs (Admin)'],
      summary: 'Read-only oversight of every application — vet_job.read',
      security: bearer,
      responses: {
        200: ok('Applications', listOf('#/components/schemas/VetJobApplication')),
        ...errs(401, 403),
      },
    },
  },
};

export const vetJobsOpenApi = { tags, paths, schemas };
