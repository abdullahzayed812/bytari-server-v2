/**
 * OpenAPI fragments for Veterinarian Courses & Seminars ("الدورات والندوات").
 * Veterinarian-created courses / seminars / workshops (moderated PENDING →
 * APPROVED/REJECTED) and veterinarian registrations against approved
 * courses (capacity / deadline / at-most-once enforced synchronously).
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
    409: 'Conflict (already registered, not open for registration, capacity full, already reviewed)',
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
const courseType = { type: 'string', enum: ['COURSE', 'SEMINAR', 'WORKSHOP'] };
const locationMode = { type: 'string', enum: ['ONLINE', 'IN_PERSON'] };

const tags = [
  { name: 'Veterinarian Courses & Seminars', description: 'Courses/seminars/workshops + registrations.' },
  { name: 'Veterinarian Courses & Seminars (Admin)', description: 'Course moderation (vet_course.*).' },
];

const schemas: Obj = {
  VetCourse: {
    type: 'object',
    properties: {
      id: uuid,
      creatorUserId: uuid,
      creator: userSummary,
      type: courseType,
      title: { type: 'string' },
      description: { type: 'string' },
      organizingBody: { type: 'string' },
      instructorName: { type: 'string' },
      instructorSpecialty: { type: 'string', nullable: true },
      startDate: { type: 'string', format: 'date' },
      endDate: { type: 'string', format: 'date' },
      startTime: { type: 'string', nullable: true },
      endTime: { type: 'string', nullable: true },
      timezoneNote: { type: 'string', nullable: true },
      locationMode,
      locationDetails: { type: 'string' },
      capacity: { type: 'integer', nullable: true },
      price: { ...money, nullable: true },
      registrationDeadline: { type: 'string', format: 'date', nullable: true },
      topics: { type: 'array', items: { type: 'string' } },
      coverImageUrl: { type: 'string', nullable: true },
      status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
      rejectionReason: { type: 'string', nullable: true },
      cancelledAt: { type: 'string', format: 'date-time', nullable: true },
      registrationCount: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  PublicVetCourse: {
    type: 'object',
    properties: {
      id: uuid,
      type: courseType,
      title: { type: 'string' },
      description: { type: 'string' },
      organizingBody: { type: 'string' },
      instructorName: { type: 'string' },
      instructorSpecialty: { type: 'string', nullable: true },
      startDate: { type: 'string', format: 'date' },
      endDate: { type: 'string', format: 'date' },
      startTime: { type: 'string', nullable: true },
      endTime: { type: 'string', nullable: true },
      timezoneNote: { type: 'string', nullable: true },
      locationMode,
      locationDetails: { type: 'string' },
      capacity: { type: 'integer', nullable: true },
      remainingSeats: { type: 'integer', nullable: true },
      price: { ...money, nullable: true },
      registrationDeadline: { type: 'string', format: 'date', nullable: true },
      topics: { type: 'array', items: { type: 'string' } },
      coverImageUrl: { type: 'string', nullable: true },
      publishedAt: { type: 'string', format: 'date-time' },
    },
  },
  VetCourseRegistration: {
    type: 'object',
    properties: {
      id: uuid,
      courseId: uuid,
      registrant: userSummary,
      fullName: { type: 'string' },
      phone: { type: 'string' },
      email: { type: 'string', nullable: true },
      governorate: { type: 'string' },
      specialty: { type: 'string', nullable: true },
      notes: { type: 'string', nullable: true },
      course: {
        type: 'object',
        nullable: true,
        properties: {
          id: uuid,
          title: { type: 'string' },
          type: courseType,
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          locationMode,
          organizingBody: { type: 'string' },
          coverImageUrl: { type: 'string', nullable: true },
          cancelledAt: { type: 'string', format: 'date-time', nullable: true },
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
  '/vet-courses/images/upload-url': {
    post: {
      tags: ['Veterinarian Courses & Seminars'],
      summary: 'Request a presigned R2 upload URL for a course cover image',
      security: bearer,
      responses: { 201: ok('Upload URL', uploadUrlResult), ...errs(400, 401, 422) },
    },
  },
  '/vet-courses': {
    get: {
      tags: ['Veterinarian Courses & Seminars'],
      summary: 'الدورات والندوات — browse APPROVED, not-cancelled courses/seminars/workshops',
      security: bearer,
      responses: { 200: ok('Courses', listOf('#/components/schemas/PublicVetCourse')), ...errs(401) },
    },
    post: {
      tags: ['Veterinarian Courses & Seminars'],
      summary: 'Create a course/seminar/workshop (approved veterinarian only) — starts PENDING',
      security: bearer,
      responses: {
        201: ok('Course', dataOf({ $ref: '#/components/schemas/VetCourse' })),
        ...errs(400, 401, 403, 422),
      },
    },
  },
  '/vet-courses/mine': {
    get: {
      tags: ['Veterinarian Courses & Seminars'],
      summary: "The caller's own created courses (any status)",
      security: bearer,
      responses: { 200: ok('Courses', listOf('#/components/schemas/VetCourse')), ...errs(401) },
    },
  },
  '/vet-courses/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinarian Courses & Seminars'],
      summary: 'تفاصيل الدورة — course/seminar detail (APPROVED, not cancelled only)',
      security: bearer,
      responses: {
        200: ok('Course', dataOf({ $ref: '#/components/schemas/PublicVetCourse' })),
        ...errs(401, 404),
      },
    },
    patch: {
      tags: ['Veterinarian Courses & Seminars'],
      summary: 'Update the course (creator only; a rejected course resets to PENDING)',
      security: bearer,
      responses: {
        200: ok('Course', dataOf({ $ref: '#/components/schemas/VetCourse' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
    delete: {
      tags: ['Veterinarian Courses & Seminars'],
      summary: 'Delete the course (creator or moderator)',
      security: bearer,
      responses: { 204: ok('Deleted'), ...errs(401, 403, 404) },
    },
  },
  '/vet-courses/{id}/manage': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinarian Courses & Seminars'],
      summary: 'Creator / moderator full view (moderation metadata + registration count)',
      security: bearer,
      responses: {
        200: ok('Course', dataOf({ $ref: '#/components/schemas/VetCourse' })),
        ...errs(401, 404),
      },
    },
  },
  '/vet-courses/{id}/cancel': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Veterinarian Courses & Seminars'],
      summary: 'إلغاء الدورة — the creator (or a moderator) cancels an approved course',
      security: bearer,
      responses: {
        200: ok('Course', dataOf({ $ref: '#/components/schemas/VetCourse' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/vet-courses/{id}/registrations': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Veterinarian Courses & Seminars'],
      summary: 'التسجيل في الدورة — register for this course (approved veterinarian only)',
      security: bearer,
      responses: {
        201: ok('Registration', dataOf({ $ref: '#/components/schemas/VetCourseRegistration' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
    get: {
      tags: ['Veterinarian Courses & Seminars'],
      summary: 'Registrants of this course (the course creator or a moderator only)',
      security: bearer,
      responses: {
        200: ok('Registrations', listOf('#/components/schemas/VetCourseRegistration')),
        ...errs(401, 404),
      },
    },
  },
  '/vet-courses/registrations/mine': {
    get: {
      tags: ['Veterinarian Courses & Seminars'],
      summary: 'دوراتي — the caller\'s own registrations',
      security: bearer,
      responses: {
        200: ok('Registrations', listOf('#/components/schemas/VetCourseRegistration')),
        ...errs(401),
      },
    },
  },
  '/vet-courses/registrations/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinarian Courses & Seminars'],
      summary: 'One registration (the registrant or the course creator/moderator only)',
      security: bearer,
      responses: {
        200: ok('Registration', dataOf({ $ref: '#/components/schemas/VetCourseRegistration' })),
        ...errs(401, 404),
      },
    },
  },

  // --- admin -----------------------------------------------
  '/admin/vet-courses': {
    get: {
      tags: ['Veterinarian Courses & Seminars (Admin)'],
      summary: 'List courses/seminars/workshops for moderation — vet_course.read',
      security: bearer,
      responses: { 200: ok('Courses', listOf('#/components/schemas/VetCourse')), ...errs(401, 403) },
    },
  },
  '/admin/vet-courses/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinarian Courses & Seminars (Admin)'],
      summary: 'Course moderation detail — vet_course.read',
      security: bearer,
      responses: {
        200: ok('Course', dataOf({ $ref: '#/components/schemas/VetCourse' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/vet-courses/{id}/approve': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Veterinarian Courses & Seminars (Admin)'],
      summary: 'Approve a pending course/seminar/workshop — vet_course.approve',
      security: bearer,
      responses: {
        200: ok('Course', dataOf({ $ref: '#/components/schemas/VetCourse' })),
        ...errs(401, 403, 404, 409),
      },
    },
  },
  '/admin/vet-courses/{id}/reject': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Veterinarian Courses & Seminars (Admin)'],
      summary: 'Reject a pending course/seminar/workshop — vet_course.reject',
      security: bearer,
      responses: {
        200: ok('Course', dataOf({ $ref: '#/components/schemas/VetCourse' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
  },
  '/admin/vet-courses/{id}/cancel': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Veterinarian Courses & Seminars (Admin)'],
      summary: 'Cancel an approved course/seminar/workshop — vet_course.approve',
      security: bearer,
      responses: {
        200: ok('Course', dataOf({ $ref: '#/components/schemas/VetCourse' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/vet-courses/{id}/registrations': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinarian Courses & Seminars (Admin)'],
      summary: 'Read-only oversight of registrations for one course — vet_course.read',
      security: bearer,
      responses: {
        200: ok('Registrations', listOf('#/components/schemas/VetCourseRegistration')),
        ...errs(401, 403, 404),
      },
    },
  },
};

export const vetCoursesOpenApi = { tags, paths, schemas };
