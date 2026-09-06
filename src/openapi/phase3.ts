/**
 * OpenAPI fragments for Phase 3 (Organizations, memberships, org-scoped
 * authorization). Merged into the base document by `buildOpenApiDocument`.
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
    403: 'Not permitted (org membership / permission / lifecycle / vet requirement)',
    404: 'Resource not found (or not visible to the caller)',
    409: 'Conflict with current state',
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

const orgIdParam = {
  name: 'organizationId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const idParam = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

const schemas: Obj = {
  Organization: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      type: {
        type: 'string',
        enum: ['CLINIC', 'FARM', 'VETERINARY_OFFICE', 'VETERINARY_STORE'],
      },
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      ownerUserId: { type: 'string', format: 'uuid' },
      status: {
        type: 'string',
        enum: ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'DEACTIVATED'],
      },
      decidedBy: { type: 'string', format: 'uuid', nullable: true },
      decidedAt: { type: 'string', format: 'date-time', nullable: true },
      decisionReason: { type: 'string', nullable: true },
      details: {
        type: 'object',
        properties: {
          joinCode: { type: 'string', description: 'FARM only' },
          subscriptionStartDate: {
            type: 'string',
            format: 'date',
            nullable: true,
            description: 'FARM only — admin/supervisor-controlled',
          },
          subscriptionEndDate: {
            type: 'string',
            format: 'date',
            nullable: true,
            description: 'FARM only — admin/supervisor-controlled',
          },
          subscriptionStatus: {
            type: 'string',
            nullable: true,
            enum: ['NOT_STARTED', 'ACTIVE', 'EXPIRED'],
            description:
              'FARM only — computed server-side from the subscription dates vs now(), ' +
              'separate from `status` (the approval state)',
          },
          address: {
            type: 'string',
            nullable: true,
            description: 'CLINIC / VETERINARY_OFFICE / VETERINARY_STORE only',
          },
          latitude: { type: 'number', nullable: true, minimum: -90, maximum: 90 },
          longitude: { type: 'number', nullable: true, minimum: -180, maximum: 180 },
          phone: { type: 'string', nullable: true },
          logoUrl: { type: 'string', nullable: true, description: 'Resolved, not a storage key' },
        },
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  PublicOrganization: {
    type: 'object',
    description: 'Directory view — any authenticated user, ACTIVE organizations only',
    properties: {
      id: { type: 'string', format: 'uuid' },
      type: {
        type: 'string',
        enum: ['CLINIC', 'FARM', 'VETERINARY_OFFICE', 'VETERINARY_STORE'],
      },
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      address: { type: 'string', nullable: true },
      latitude: { type: 'number', nullable: true },
      longitude: { type: 'number', nullable: true },
      phone: { type: 'string', nullable: true },
      logoUrl: { type: 'string', nullable: true },
      workingHours: { type: 'string', nullable: true },
      services: { type: 'array', items: { type: 'string' } },
      email: { type: 'string', nullable: true },
      whatsapp: { type: 'string', nullable: true },
      instagramUrl: { type: 'string', nullable: true },
      facebookUrl: { type: 'string', nullable: true },
      tiktokUrl: { type: 'string', nullable: true },
      galleryUrls: { type: 'array', items: { type: 'string' } },
      distanceKm: {
        type: 'number',
        nullable: true,
        description: 'Only set when `sort=nearest`',
      },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  PublicOrganizationDetail: {
    allOf: [
      { $ref: '#/components/schemas/PublicOrganization' },
      {
        type: 'object',
        description: 'GET /organizations/discover/{id} — the Clinic Details screen',
        properties: {
          veterinarians: {
            type: 'array',
            description: 'ACTIVE VETERINARIAN members — public-safe subset',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                firstName: { type: 'string' },
                lastName: { type: 'string' },
              },
            },
          },
          engagement: {
            type: 'object',
            properties: {
              isFollowing: { type: 'boolean' },
              followersCount: { type: 'integer' },
              rating: { type: 'number', nullable: true, description: 'Average, 1 decimal' },
              reviewsCount: { type: 'integer' },
            },
          },
        },
      },
    ],
  },
  OrganizationMembership: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      organizationId: { type: 'string', format: 'uuid' },
      userId: { type: 'string', format: 'uuid' },
      roleKey: { type: 'string', enum: ['OWNER', 'VETERINARIAN', 'SUPERVISOR', 'STAFF'] },
      status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'REMOVED', 'LEFT'] },
      user: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
        },
      },
      permissions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Selected permissions — SUPERVISOR memberships only',
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  CreateOrganizationRequest: {
    type: 'object',
    required: ['type', 'name'],
    properties: {
      type: {
        type: 'string',
        enum: ['CLINIC', 'FARM', 'VETERINARY_OFFICE', 'VETERINARY_STORE'],
      },
      name: { type: 'string', minLength: 2, maxLength: 160 },
      description: { type: 'string', maxLength: 2000 },
    },
  },
};

const paths: Obj = {
  '/organizations': {
    post: {
      tags: ['Organizations'],
      summary: 'Create an organization (starts PENDING; caller becomes OWNER)',
      description:
        'Creating a CLINIC or FARM requires an APPROVED veterinarian account. An OWNER membership is created automatically.',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateOrganizationRequest' },
          },
        },
      },
      responses: {
        '201': ok('Created', dataOf({ $ref: '#/components/schemas/Organization' })),
        ...errs(401, 403, 409, 422),
      },
    },
    get: {
      tags: ['Organizations'],
      summary: 'List the organizations the caller is an active member of',
      security: bearer,
      responses: { '200': ok('Paginated organizations'), ...errs(401) },
    },
  },
  '/organizations/{organizationId}': {
    get: {
      tags: ['Organizations'],
      summary: 'Get one organization (requires `organization.read` in that org)',
      security: bearer,
      parameters: [orgIdParam],
      responses: {
        '200': ok('Organization', dataOf({ $ref: '#/components/schemas/Organization' })),
        ...errs(401, 403, 404),
      },
    },
    patch: {
      tags: ['Organizations'],
      summary: 'Update the organization profile (requires `organization.update`)',
      description:
        'address/phone/latitude/longitude are only accepted for CLINIC / VETERINARY_OFFICE / ' +
        'VETERINARY_STORE (422 `ORGANIZATION_TYPE_NOT_SUPPORTED` otherwise). latitude and ' +
        'longitude must be provided together.',
      security: bearer,
      parameters: [orgIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string', nullable: true },
                address: { type: 'string', nullable: true },
                phone: { type: 'string', nullable: true },
                latitude: { type: 'number', nullable: true, minimum: -90, maximum: 90 },
                longitude: { type: 'number', nullable: true, minimum: -180, maximum: 180 },
                workingHours: { type: 'string', nullable: true },
                services: { type: 'array', items: { type: 'string' }, maxItems: 20 },
                email: { type: 'string', nullable: true, format: 'email' },
                whatsapp: { type: 'string', nullable: true },
                instagramUrl: { type: 'string', nullable: true, format: 'uri' },
                facebookUrl: { type: 'string', nullable: true, format: 'uri' },
                tiktokUrl: { type: 'string', nullable: true, format: 'uri' },
              },
            },
          },
        },
      },
      responses: {
        '200': ok('Updated', dataOf({ $ref: '#/components/schemas/Organization' })),
        ...errs(401, 403, 404, 422),
      },
    },
  },
  '/organizations/discover': {
    get: {
      tags: ['Organizations'],
      summary: 'Browse ACTIVE organizations — any authenticated user, not just members',
      description:
        'Backs the Pet Owner directory screens (clinics / veterinary offices / stores). When ' +
        '`type` has a directory profile, results include address/coordinates/phone/logo. ' +
        '`sort=nearest` (requires `lat` and `lng`) orders by server-computed great-circle ' +
        'distance — the client never computes distance itself.',
      security: bearer,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        {
          name: 'type',
          in: 'query',
          schema: {
            type: 'string',
            enum: ['CLINIC', 'FARM', 'VETERINARY_OFFICE', 'VETERINARY_STORE'],
          },
        },
        { name: 'search', in: 'query', schema: { type: 'string' } },
        { name: 'sort', in: 'query', schema: { type: 'string', enum: ['default', 'nearest'] } },
        { name: 'lat', in: 'query', schema: { type: 'number', minimum: -90, maximum: 90 } },
        { name: 'lng', in: 'query', schema: { type: 'number', minimum: -180, maximum: 180 } },
      ],
      responses: {
        '200': ok(
          'Paginated organizations',
          dataOf({ type: 'array', items: { $ref: '#/components/schemas/PublicOrganization' } }),
        ),
        ...errs(401, 422),
      },
    },
  },
  '/organizations/discover/{organizationId}': {
    get: {
      tags: ['Organizations'],
      summary: 'Clinic Details — one ACTIVE organization, any authenticated user, not just members',
      description:
        "Full profile + the ACTIVE veterinarian roster + the viewer's engagement summary " +
        '(follow state, rating). Composed from three independent reads — see ' +
        '`OrganizationController.getPublicOne`.',
      security: bearer,
      parameters: [orgIdParam],
      responses: {
        '200': ok(
          'Organization',
          dataOf({ $ref: '#/components/schemas/PublicOrganizationDetail' }),
        ),
        ...errs(401, 404),
      },
    },
  },
  '/organizations/{organizationId}/logo/upload-url': {
    post: {
      tags: ['Organizations'],
      summary: 'Request a presigned upload URL for the organization logo',
      description:
        'CLINIC / VETERINARY_OFFICE / VETERINARY_STORE only; requires `organization.update`. ' +
        'The server generates the storage key — PUT the file bytes to `uploadUrl`, then call ' +
        'POST .../logo to register it.',
      security: bearer,
      parameters: [orgIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['filename', 'mimeType', 'size'],
              properties: {
                filename: { type: 'string' },
                mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] },
                size: { type: 'integer', maximum: 5 * 1024 * 1024 },
              },
            },
          },
        },
      },
      responses: { '201': ok('Upload URL issued'), ...errs(400, 401, 403, 404, 422) },
    },
  },
  '/organizations/{organizationId}/logo': {
    post: {
      tags: ['Organizations'],
      summary: 'Register an uploaded logo (requires `organization.update`)',
      security: bearer,
      parameters: [orgIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['storageKey', 'mimeType'],
              properties: {
                storageKey: { type: 'string' },
                mimeType: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '200': ok('Logo updated', dataOf({ $ref: '#/components/schemas/Organization' })),
        ...errs(400, 401, 403, 404, 409, 422),
      },
    },
  },
  '/organizations/{organizationId}/leave': {
    post: {
      tags: ['Organizations'],
      summary: 'Leave the organization (non-owner members only)',
      security: bearer,
      parameters: [orgIdParam],
      responses: { '200': ok('Left'), ...errs(401, 403, 404, 409) },
    },
  },
  '/organizations/{organizationId}/members': {
    get: {
      tags: ['Organizations · Members'],
      summary: 'List members (requires `member.read`)',
      security: bearer,
      parameters: [orgIdParam],
      responses: { '200': ok('Paginated members'), ...errs(401, 403, 404) },
    },
    post: {
      tags: ['Organizations · Members'],
      summary: 'Add a member as VETERINARIAN or STAFF (requires `member.add`)',
      description:
        'Identify the target by exactly one of `userId` or `email` (the email must belong to an existing account). Adding a VETERINARIAN requires the target to be an APPROVED veterinarian.',
      security: bearer,
      parameters: [orgIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['role'],
              properties: {
                userId: { type: 'string', format: 'uuid' },
                email: { type: 'string', format: 'email' },
                role: { type: 'string', enum: ['VETERINARIAN', 'STAFF'] },
              },
            },
          },
        },
      },
      responses: {
        '201': ok('Added', dataOf({ $ref: '#/components/schemas/OrganizationMembership' })),
        ...errs(400, 401, 403, 404, 409),
      },
    },
  },
  '/organizations/{organizationId}/members/{memberId}': {
    get: {
      tags: ['Organizations · Members'],
      summary: 'Get one member (requires `member.read`)',
      security: bearer,
      parameters: [
        orgIdParam,
        {
          name: 'memberId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': ok('Member'), ...errs(401, 403, 404) },
    },
    patch: {
      tags: ['Organizations · Members'],
      summary: 'Change a member’s role/status (requires `member.update`; OWNER cannot be modified)',
      security: bearer,
      parameters: [
        orgIdParam,
        {
          name: 'memberId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': ok('Updated'), ...errs(400, 401, 403, 404) },
    },
    delete: {
      tags: ['Organizations · Members'],
      summary: 'Remove a member (requires `member.remove`; OWNER cannot be removed)',
      security: bearer,
      parameters: [
        orgIdParam,
        {
          name: 'memberId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': ok('Removed'), ...errs(401, 403, 404) },
    },
  },
  '/organizations/{organizationId}/supervisors': {
    get: {
      tags: ['Organizations · Supervisors'],
      summary: 'List supervisors and their selected permissions (requires `supervisor.read`)',
      security: bearer,
      parameters: [orgIdParam],
      responses: { '200': ok('Supervisors'), ...errs(401, 403, 404) },
    },
    post: {
      tags: ['Organizations · Supervisors'],
      summary: 'Assign an approved veterinarian as supervisor with selected permissions',
      description:
        'Requires `supervisor.assign`. Target must be an APPROVED veterinarian, not the owner, and not the caller.',
      security: bearer,
      parameters: [orgIdParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['userId', 'permissions'],
              properties: {
                userId: { type: 'string', format: 'uuid' },
                permissions: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      responses: {
        '201': ok('Assigned', dataOf({ $ref: '#/components/schemas/OrganizationMembership' })),
        ...errs(400, 401, 403, 404, 409),
      },
    },
  },
  '/organizations/{organizationId}/supervisors/{membershipId}': {
    patch: {
      tags: ['Organizations · Supervisors'],
      summary: 'Replace a supervisor’s selected permissions (requires `supervisor.assign`)',
      security: bearer,
      parameters: [
        orgIdParam,
        {
          name: 'membershipId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': ok('Updated'), ...errs(400, 401, 403, 404) },
    },
    delete: {
      tags: ['Organizations · Supervisors'],
      summary: 'Remove a supervisor (requires `supervisor.remove`)',
      security: bearer,
      parameters: [
        orgIdParam,
        {
          name: 'membershipId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': ok('Removed'), ...errs(400, 401, 403, 404) },
    },
  },

  '/admin/organizations': {
    get: {
      tags: ['Admin · Organizations'],
      summary: 'List all organizations (requires `organization.admin.read`)',
      security: bearer,
      parameters: [
        { name: 'type', in: 'query', schema: { type: 'string' } },
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'ownerUserId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
      ],
      responses: { '200': ok('Paginated organizations'), ...errs(401, 403) },
    },
  },
  '/admin/organizations/pending': {
    get: {
      tags: ['Admin · Organizations'],
      summary: 'List pending organizations awaiting review (`organization.admin.read`)',
      security: bearer,
      responses: { '200': ok('Paginated organizations'), ...errs(401, 403) },
    },
  },
  '/admin/organizations/{id}': {
    get: {
      tags: ['Admin · Organizations'],
      summary: 'Get any organization (`organization.admin.read`)',
      security: bearer,
      parameters: [idParam],
      responses: {
        '200': ok('Organization', dataOf({ $ref: '#/components/schemas/Organization' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/organizations/{id}/members': {
    get: {
      tags: ['Admin · Organizations'],
      summary: 'List any organization’s members (`organization.admin.read`)',
      security: bearer,
      parameters: [idParam],
      responses: { '200': ok('Members'), ...errs(401, 403, 404) },
    },
  },
  '/admin/organizations/{id}/approve': {
    post: {
      tags: ['Admin · Organizations'],
      summary: 'Approve a pending organization (`organization.admin.approve`)',
      security: bearer,
      parameters: [idParam],
      responses: {
        '200': ok('Approved', dataOf({ $ref: '#/components/schemas/Organization' })),
        ...errs(401, 403, 404, 409),
      },
    },
  },
  '/admin/organizations/{id}/reject': {
    post: {
      tags: ['Admin · Organizations'],
      summary: 'Reject a pending organization (`organization.admin.approve`)',
      security: bearer,
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['reason'],
              properties: { reason: { type: 'string' } },
            },
          },
        },
      },
      responses: {
        '200': ok('Rejected', dataOf({ $ref: '#/components/schemas/Organization' })),
        ...errs(401, 403, 404, 409, 422),
      },
    },
  },
  '/admin/organizations/{id}/suspend': {
    post: {
      tags: ['Admin · Organizations'],
      summary: 'Suspend an organization (`organization.admin.status`)',
      security: bearer,
      parameters: [idParam],
      responses: {
        '200': ok('Suspended', dataOf({ $ref: '#/components/schemas/Organization' })),
        ...errs(401, 403, 404, 409),
      },
    },
  },
  '/admin/organizations/{id}/activate': {
    post: {
      tags: ['Admin · Organizations'],
      summary: 'Activate a suspended/deactivated organization (`organization.admin.status`)',
      security: bearer,
      parameters: [idParam],
      responses: {
        '200': ok('Activated', dataOf({ $ref: '#/components/schemas/Organization' })),
        ...errs(401, 403, 404, 409),
      },
    },
  },
  '/admin/organizations/{id}/deactivate': {
    post: {
      tags: ['Admin · Organizations'],
      summary: 'Deactivate an organization (`organization.admin.status`)',
      security: bearer,
      parameters: [idParam],
      responses: {
        '200': ok('Deactivated', dataOf({ $ref: '#/components/schemas/Organization' })),
        ...errs(401, 403, 404, 409),
      },
    },
  },
  '/admin/organizations/{id}/members/{memberId}': {
    delete: {
      tags: ['Admin · Organizations'],
      summary:
        'Remove a member from any organization (`organization.admin.manage`; OWNER protected)',
      security: bearer,
      parameters: [
        idParam,
        {
          name: 'memberId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': ok('Removed'), ...errs(401, 403, 404) },
    },
  },
  '/admin/organizations/{id}/supervisors/{memberId}': {
    delete: {
      tags: ['Admin · Organizations'],
      summary: 'Remove a supervisor from any organization (`organization.admin.manage`)',
      security: bearer,
      parameters: [
        idParam,
        {
          name: 'memberId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': ok('Removed'), ...errs(400, 401, 403, 404) },
    },
  },
  '/admin/organizations/farms': {
    get: {
      tags: ['Admin · Organizations'],
      summary:
        'Poultry Farms management list — owner, supervisors, subscription dates/status, ' +
        'open-renewal flag (`organization.admin.read`)',
      security: bearer,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
        {
          name: 'status',
          in: 'query',
          schema: { type: 'string', enum: ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'DEACTIVATED'] },
        },
        {
          name: 'subscriptionStatus',
          in: 'query',
          schema: { type: 'string', enum: ['NOT_STARTED', 'ACTIVE', 'EXPIRED'] },
        },
      ],
      responses: { '200': ok('Farms'), ...errs(401, 403) },
    },
  },
  '/admin/organizations/{id}/subscription-renewals': {
    get: {
      tags: ['Admin · Organizations'],
      summary: 'List a farm’s subscription renewal requests (`organization.admin.read`)',
      security: bearer,
      parameters: [idParam],
      responses: { '200': ok('Renewal requests'), ...errs(401, 403, 404) },
    },
  },
  '/admin/organizations/{id}/subscription': {
    post: {
      tags: ['Admin · Organizations'],
      summary: 'Set a farm’s subscription period directly (`organization.admin.subscription`)',
      security: bearer,
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['startDate', 'endDate'],
              properties: {
                startDate: { type: 'string', format: 'date' },
                endDate: { type: 'string', format: 'date' },
              },
            },
          },
        },
      },
      responses: { '200': ok('Updated'), ...errs(400, 401, 403, 404, 422) },
    },
  },
  '/admin/organizations/{id}/subscription-renewals/{requestId}/approve': {
    post: {
      tags: ['Admin · Organizations'],
      summary:
        'Approve a farm’s renewal request and set the new subscription period ' +
        '(`organization.admin.subscription`)',
      security: bearer,
      parameters: [
        idParam,
        { name: 'requestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['startDate', 'endDate'],
              properties: {
                startDate: { type: 'string', format: 'date' },
                endDate: { type: 'string', format: 'date' },
              },
            },
          },
        },
      },
      responses: { '200': ok('Approved'), ...errs(400, 401, 403, 404, 409, 422) },
    },
  },
  '/admin/organizations/{id}/subscription-renewals/{requestId}/reject': {
    post: {
      tags: ['Admin · Organizations'],
      summary: 'Reject a farm’s renewal request (`organization.admin.subscription`)',
      security: bearer,
      parameters: [
        idParam,
        { name: 'requestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['reason'],
              properties: { reason: { type: 'string', minLength: 3 } },
            },
          },
        },
      },
      responses: { '200': ok('Rejected'), ...errs(400, 401, 403, 404, 409, 422) },
    },
  },
};

const tags = [
  { name: 'Organizations', description: 'Create & read organizations; organization-scoped access' },
  { name: 'Organizations · Members', description: 'Organization membership management' },
  { name: 'Organizations · Supervisors', description: 'Organization supervisor assignments' },
  { name: 'Admin · Organizations', description: 'System-wide organization administration' },
];

export const phase3OpenApi = { tags, paths, schemas };
