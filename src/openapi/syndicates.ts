/**
 * OpenAPI fragments for Veterinary Syndicates / Unions ("نقابة الأطباء
 * البيطريين"). A syndicate is an `organizations` row (`type = 'SYNDICATE'`)
 * reusing the organization-scoped membership/supervisor RBAC and follow
 * feature — see `syndicate.ts` module docs. Announcements publish
 * immediately (no moderation); requests/inquiries ("submissions") follow a
 * PENDING → RESPONDED / CLOSED lifecycle.
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
    403: 'Authenticated but lacks the required organization-scoped permission',
    404: 'Resource not found',
    409: 'Conflict (submission already responded to / already closed)',
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
const userSummary = {
  type: 'object',
  properties: { id: uuid, firstName: { type: 'string' }, lastName: { type: 'string' } },
};

const tags = [
  {
    name: 'Veterinary Syndicates',
    description: 'Syndicate profiles, branches, announcements, requests & inquiries.',
  },
  {
    name: 'Veterinary Syndicates (Admin)',
    description: 'Syndicate creation (syndicate.admin.create).',
  },
];

const schemas: Obj = {
  SyndicateServiceContent: {
    type: 'object',
    description: 'A service page document; array order is display order. Replaced whole on save.',
    properties: {
      heading: { type: 'string', nullable: true, maxLength: 120 },
      body: { type: 'string', nullable: true, maxLength: 4000 },
      sections: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          required: ['title', 'items'],
          properties: {
            id: { type: 'string', description: 'Stable key; assigned by the server when omitted' },
            title: { type: 'string', minLength: 1, maxLength: 200 },
            style: { type: 'string', enum: ['CHECK', 'NOTE'], default: 'CHECK' },
            items: {
              type: 'array',
              maxItems: 50,
              items: {
                type: 'object',
                required: ['text'],
                properties: {
                  id: { type: 'string' },
                  text: { type: 'string', minLength: 1, maxLength: 1000 },
                },
              },
            },
          },
        },
      },
      footnote: { type: 'string', nullable: true, maxLength: 1000 },
      note: { type: 'string', nullable: true, maxLength: 1000 },
    },
  },
  SyndicateService: {
    type: 'object',
    description:
      'One of the six fixed services of a syndicate; null title/description = app default text.',
    properties: {
      id: uuid,
      organizationId: uuid,
      serviceKey: {
        type: 'string',
        enum: [
          'ID_CARD',
          'INQUIRY',
          'ANNOUNCEMENTS',
          'REGISTER_DOCTORS',
          'LEGAL_SUPPORT',
          'OFFICE_LICENSES',
        ],
      },
      title: { type: 'string', nullable: true, maxLength: 120 },
      description: { type: 'string', nullable: true, maxLength: 4000 },
      isEnabled: { type: 'boolean' },
      sortOrder: { type: 'integer' },
      content: {
        nullable: true,
        allOf: [{ $ref: '#/components/schemas/SyndicateServiceContent' }],
        description:
          'Page content of ID_CARD / LEGAL_SUPPORT / OFFICE_LICENSES; null = the app built-in content.',
      },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  PublicSyndicate: {
    type: 'object',
    properties: {
      id: uuid,
      parentOrganizationId: { ...uuid, nullable: true },
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      status: { type: 'string' },
      governorate: { type: 'string', nullable: true },
      address: { type: 'string', nullable: true },
      phone: { type: 'string', nullable: true },
      email: { type: 'string', nullable: true },
      website: { type: 'string', nullable: true },
      logoUrl: { type: 'string', nullable: true },
      headOfficerName: { type: 'string', nullable: true },
      headOfficerTitle: { type: 'string', nullable: true },
      termStartYear: { type: 'integer', nullable: true },
      termEndYear: { type: 'integer', nullable: true },
      branchCount: { type: 'integer' },
      isFollowing: { type: 'boolean' },
      followersCount: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  SyndicateAnnouncement: {
    type: 'object',
    properties: {
      id: uuid,
      organizationId: uuid,
      syndicateName: { type: 'string' },
      type: { type: 'string', enum: ['ANNOUNCEMENT', 'IMPORTANT_NOTICE'] },
      title: { type: 'string' },
      body: { type: 'string' },
      imageUrl: { type: 'string', nullable: true },
      linkUrl: {
        type: 'string',
        format: 'uri',
        nullable: true,
        description: 'Optional external http(s) link',
      },
      publishedAt: { type: 'string', format: 'date-time' },
    },
  },
  SyndicateSubmission: {
    type: 'object',
    properties: {
      id: uuid,
      organizationId: uuid,
      syndicateName: { type: 'string' },
      isUnread: {
        type: 'boolean',
        description:
          'List reads only — the caller still has an unread alert for it (officer: new submission; submitter: new reply).',
      },
      kind: { type: 'string', enum: ['REQUEST', 'INQUIRY'] },
      requestType: {
        type: 'string',
        nullable: true,
        enum: [
          'ID_ISSUANCE',
          'ID_RENEWAL',
          'OFFICE_LICENSE_ISSUANCE',
          'OFFICE_LICENSE_RENEWAL',
          'OTHER',
        ],
      },
      message: { type: 'string' },
      attachmentUrls: { type: 'array', items: { type: 'string' } },
      submittedBy: userSummary,
      status: { type: 'string', enum: ['PENDING', 'RESPONDED', 'CLOSED'] },
      responseText: { type: 'string', nullable: true },
      respondedAt: { type: 'string', format: 'date-time', nullable: true },
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
  '/syndicates/media/upload-url': {
    post: {
      tags: ['Veterinary Syndicates'],
      summary:
        'Request a presigned R2 upload URL — kind: LOGO | ANNOUNCEMENT_IMAGE | SUBMISSION_ATTACHMENT',
      security: bearer,
      responses: { 201: ok('Upload URL', uploadUrlResult), ...errs(400, 401, 422) },
    },
  },
  '/syndicates': {
    get: {
      tags: ['Veterinary Syndicates'],
      summary: 'Browse main (root) syndicates',
      security: bearer,
      responses: {
        200: ok('Syndicates', listOf('#/components/schemas/PublicSyndicate')),
        ...errs(401),
      },
    },
  },
  '/syndicates/{organizationId}': {
    parameters: [{ name: 'organizationId', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinary Syndicates'],
      summary: 'One syndicate profile (main or branch)',
      security: bearer,
      responses: {
        200: ok('Syndicate', dataOf({ $ref: '#/components/schemas/PublicSyndicate' })),
        ...errs(401, 404),
      },
    },
  },
  '/syndicates/{organizationId}/pin': {
    parameters: [{ name: 'organizationId', in: 'path', required: true, schema: uuid }],
    put: {
      tags: ['Veterinary Syndicates'],
      summary: 'تثبيت النقابة — pin / unpin for YOUR OWN Veterinarian Home',
      description:
        'Body `{ pinned: boolean }`. Any approved veterinarian (or Admin); per-user — never ' +
        "affects anyone else's Home. `GET /syndicates/pinned` lists the caller's pins.",
      security: bearer,
      responses: {
        200: ok('Syndicate', dataOf({ $ref: '#/components/schemas/PublicSyndicate' })),
        ...errs(401, 403, 404, 409, 422),
      },
    },
  },
  '/syndicates/{organizationId}/branches': {
    parameters: [{ name: 'organizationId', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinary Syndicates'],
      summary: 'فروع النقابة — subordinate/branch syndicates of a main syndicate',
      security: bearer,
      responses: {
        200: ok('Branches', listOf('#/components/schemas/PublicSyndicate')),
        ...errs(401),
      },
    },
  },
  '/syndicates/{organizationId}/my-access': {
    parameters: [{ name: 'organizationId', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinary Syndicates'],
      summary:
        'What can the caller do for this syndicate — drives client-side management UI visibility',
      security: bearer,
      responses: {
        200: ok(
          'Access',
          dataOf({
            type: 'object',
            properties: {
              isAdmin: { type: 'boolean' },
              isOwner: { type: 'boolean' },
              canManageProfile: { type: 'boolean' },
              canManageAnnouncements: { type: 'boolean' },
              canReadSubmissions: { type: 'boolean' },
              canRespondSubmissions: { type: 'boolean' },
            },
          }),
        ),
        ...errs(401),
      },
    },
  },
  '/syndicates/{organizationId}/profile': {
    parameters: [{ name: 'organizationId', in: 'path', required: true, schema: uuid }],
    patch: {
      tags: ['Veterinary Syndicates'],
      summary: 'Update the syndicate profile — syndicate.profile.manage',
      security: bearer,
      responses: {
        200: ok('Syndicate', dataOf({ $ref: '#/components/schemas/PublicSyndicate' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/syndicates/{organizationId}/services': {
    parameters: [{ name: 'organizationId', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinary Syndicates'],
      summary: 'الخدمات — the syndicate’s services (any authenticated user)',
      security: bearer,
      responses: {
        200: ok(
          'Services',
          dataOf({ type: 'array', items: { $ref: '#/components/schemas/SyndicateService' } }),
        ),
        ...errs(401, 404),
      },
    },
  },
  '/syndicates/{organizationId}/services/{serviceId}': {
    parameters: [
      { name: 'organizationId', in: 'path', required: true, schema: uuid },
      { name: 'serviceId', in: 'path', required: true, schema: uuid },
    ],
    patch: {
      tags: ['Veterinary Syndicates'],
      summary:
        'Edit a service in place (title / description / isEnabled / page content) — syndicate.profile.manage',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                title: { type: 'string', nullable: true, maxLength: 120 },
                description: { type: 'string', nullable: true, maxLength: 4000 },
                isEnabled: { type: 'boolean' },
                content: {
                  nullable: true,
                  allOf: [{ $ref: '#/components/schemas/SyndicateServiceContent' }],
                  description:
                    'Whole page document (422 for a service without a content page); null resets to built-in.',
                },
              },
            },
          },
        },
      },
      responses: {
        200: ok('Service', dataOf({ $ref: '#/components/schemas/SyndicateService' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/syndicates/{organizationId}/announcements': {
    parameters: [{ name: 'organizationId', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinary Syndicates'],
      summary: "الإعلانات والتبليغات — this syndicate's announcements",
      security: bearer,
      responses: {
        200: ok('Announcements', listOf('#/components/schemas/SyndicateAnnouncement')),
        ...errs(401),
      },
    },
    post: {
      tags: ['Veterinary Syndicates'],
      summary: 'Publish an announcement — syndicate.announcement.manage',
      security: bearer,
      responses: {
        201: ok('Announcement', dataOf({ $ref: '#/components/schemas/SyndicateAnnouncement' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
  '/syndicates/announcements/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinary Syndicates'],
      summary: 'Announcement detail',
      security: bearer,
      responses: {
        200: ok('Announcement', dataOf({ $ref: '#/components/schemas/SyndicateAnnouncement' })),
        ...errs(401, 404),
      },
    },
  },
  '/syndicates/{organizationId}/announcements/{id}': {
    parameters: [
      { name: 'organizationId', in: 'path', required: true, schema: uuid },
      { name: 'id', in: 'path', required: true, schema: uuid },
    ],
    patch: {
      tags: ['Veterinary Syndicates'],
      summary: 'Update an announcement — syndicate.announcement.manage',
      security: bearer,
      responses: {
        200: ok('Announcement', dataOf({ $ref: '#/components/schemas/SyndicateAnnouncement' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
    delete: {
      tags: ['Veterinary Syndicates'],
      summary: 'Delete an announcement — syndicate.announcement.manage',
      security: bearer,
      responses: { 204: ok('Deleted'), ...errs(401, 403, 404) },
    },
  },
  '/syndicates/{organizationId}/submissions': {
    parameters: [{ name: 'organizationId', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Veterinary Syndicates'],
      summary: 'Submit a request (kind=REQUEST) or inquiry (kind=INQUIRY) — any authenticated user',
      security: bearer,
      responses: {
        201: ok('Submission', dataOf({ $ref: '#/components/schemas/SyndicateSubmission' })),
        ...errs(400, 401, 404, 422),
      },
    },
    get: {
      tags: ['Veterinary Syndicates'],
      summary: "List this syndicate's requests/inquiries — syndicate.submission.read",
      security: bearer,
      responses: {
        200: ok('Submissions', listOf('#/components/schemas/SyndicateSubmission')),
        ...errs(401, 403),
      },
    },
  },
  '/syndicates/{organizationId}/submissions/seen': {
    parameters: [{ name: 'organizationId', in: 'path', required: true, schema: uuid }],
    post: {
      tags: ['Veterinary Syndicates'],
      summary:
        "Mark the officer's new-submission alerts of these submissions read — syndicate.submission.read",
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['submissionIds'],
              properties: {
                submissionIds: { type: 'array', items: uuid, minItems: 1, maxItems: 100 },
              },
            },
          },
        },
      },
      responses: {
        200: ok(
          'The ids actually marked (others are out of scope and ignored)',
          dataOf({ type: 'object', properties: { submissionIds: { type: 'array', items: uuid } } }),
        ),
        ...errs(401, 403, 404, 422),
      },
    },
  },
  '/syndicates/{organizationId}/submissions/{id}': {
    parameters: [
      { name: 'organizationId', in: 'path', required: true, schema: uuid },
      { name: 'id', in: 'path', required: true, schema: uuid },
    ],
    get: {
      tags: ['Veterinary Syndicates'],
      summary: 'One submission — syndicate.submission.read',
      security: bearer,
      responses: {
        200: ok('Submission', dataOf({ $ref: '#/components/schemas/SyndicateSubmission' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/syndicates/{organizationId}/submissions/{id}/respond': {
    parameters: [
      { name: 'organizationId', in: 'path', required: true, schema: uuid },
      { name: 'id', in: 'path', required: true, schema: uuid },
    ],
    post: {
      tags: ['Veterinary Syndicates'],
      summary: 'Respond to a PENDING submission — syndicate.submission.respond',
      security: bearer,
      responses: {
        200: ok('Submission', dataOf({ $ref: '#/components/schemas/SyndicateSubmission' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
  },
  '/syndicates/{organizationId}/submissions/{id}/close': {
    parameters: [
      { name: 'organizationId', in: 'path', required: true, schema: uuid },
      { name: 'id', in: 'path', required: true, schema: uuid },
    ],
    post: {
      tags: ['Veterinary Syndicates'],
      summary: 'Close a submission — syndicate.submission.respond',
      security: bearer,
      responses: {
        200: ok('Submission', dataOf({ $ref: '#/components/schemas/SyndicateSubmission' })),
        ...errs(401, 403, 404, 409),
      },
    },
  },
  '/syndicates/submissions/mine': {
    get: {
      tags: ['Veterinary Syndicates'],
      summary: "متابعة الطلب من خلال حسابك — the caller's own submissions across every syndicate",
      security: bearer,
      responses: {
        200: ok('Submissions', listOf('#/components/schemas/SyndicateSubmission')),
        ...errs(401),
      },
    },
  },
  '/syndicates/submissions/mine/seen': {
    post: {
      tags: ['Veterinary Syndicates'],
      summary: 'Mark the new-reply alerts of these (own) submissions read — per submission',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['submissionIds'],
              properties: {
                submissionIds: { type: 'array', items: uuid, minItems: 1, maxItems: 100 },
              },
            },
          },
        },
      },
      responses: {
        200: ok(
          'The ids actually marked (others are out of scope and ignored)',
          dataOf({ type: 'object', properties: { submissionIds: { type: 'array', items: uuid } } }),
        ),
        ...errs(401, 422),
      },
    },
  },
  '/syndicates/submissions/mine/{id}': {
    parameters: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    get: {
      tags: ['Veterinary Syndicates'],
      summary: "One of the caller's own submissions",
      security: bearer,
      responses: {
        200: ok('Submission', dataOf({ $ref: '#/components/schemas/SyndicateSubmission' })),
        ...errs(401, 404),
      },
    },
  },

  // --- admin -----------------------------------------------
  '/admin/syndicates': {
    post: {
      tags: ['Veterinary Syndicates (Admin)'],
      summary: 'Create a main or subordinate syndicate — syndicate.admin.create',
      security: bearer,
      responses: {
        201: ok('Syndicate', dataOf({ $ref: '#/components/schemas/PublicSyndicate' })),
        ...errs(400, 401, 403, 404, 422),
      },
    },
  },
};

export const syndicatesOpenApi = { tags, paths, schemas };
