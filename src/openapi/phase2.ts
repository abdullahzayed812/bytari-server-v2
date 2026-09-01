/**
 * OpenAPI fragments for Phase 2 (Identity, Authentication, Authorization, Audit).
 * Merged into the base document by `buildOpenApiDocument`.
 */

type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];

const errorRef = { $ref: '#/components/schemas/ErrorEnvelope' };
const jsonError = { 'application/json': { schema: errorRef } };

/** Standard error responses; pass the codes that apply to a route. */
function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Malformed request',
    401: 'Missing or invalid access token',
    403: 'Authenticated but not permitted',
    404: 'Resource not found',
    409: 'Conflict with current state',
    422: 'Request failed validation',
    429: 'Rate limit exceeded',
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

function bodyOf(schemaRef: string): Obj {
  return {
    required: true,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaRef}` } } },
  };
}

// --- schemas -----------------------------------------------------------

const schemas: Obj = {
  User: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      phone: { type: 'string', nullable: true },
      gender: { type: 'string', enum: ['MALE', 'FEMALE'], nullable: true },
      country: { type: 'string', description: 'ISO 3166-1 alpha-2', nullable: true },
      avatarKey: { type: 'string', nullable: true },
      status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] },
      veterinarianStatus: {
        type: 'string',
        enum: ['NOT_APPLIED', 'PENDING', 'APPROVED', 'REJECTED'],
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  UserSummary: {
    type: 'object',
    description:
      'Name-level directory projection. No email / phone / account status / roles — safe for ' +
      'resolving authorship & actor ids that other DTOs carry.',
    properties: {
      id: { type: 'string', format: 'uuid' },
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      veterinarianStatus: {
        type: 'string',
        enum: ['NOT_APPLIED', 'PENDING', 'APPROVED', 'REJECTED'],
      },
    },
  },
  Tokens: {
    type: 'object',
    properties: {
      accessToken: { type: 'string' },
      refreshToken: { type: 'string' },
      tokenType: { type: 'string', enum: ['Bearer'] },
      expiresIn: { type: 'integer', description: 'Access token lifetime (seconds)' },
    },
  },
  RegisterRequest: {
    type: 'object',
    required: ['email', 'password', 'firstName', 'lastName'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 10, maxLength: 128 },
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      phone: { type: 'string' },
      gender: { type: 'string', enum: ['MALE', 'FEMALE'] },
      country: { type: 'string', description: 'ISO 3166-1 alpha-2 (auto-uppercased)' },
    },
  },
  AvatarUploadUrlBody: {
    type: 'object',
    required: ['filename', 'mimeType', 'size'],
    properties: {
      filename: { type: 'string', maxLength: 255 },
      mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] },
      size: { type: 'integer', minimum: 1, maximum: 5 * 1024 * 1024 },
    },
  },
  FinalizeAvatarBody: {
    type: 'object',
    required: ['storageKey', 'mimeType', 'filename'],
    properties: {
      storageKey: { type: 'string', maxLength: 1024 },
      mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] },
      filename: { type: 'string', maxLength: 255 },
    },
  },
  PresignedUpload: {
    type: 'object',
    properties: {
      storageKey: { type: 'string' },
      uploadUrl: { type: 'string' },
      method: { type: 'string', enum: ['PUT'] },
      headers: { type: 'object', additionalProperties: { type: 'string' } },
      expiresInSeconds: { type: 'integer' },
    },
  },
  VeterinarianApplicationDocument: {
    type: 'object',
    description: 'Applicant-facing document metadata. Never includes the storage key.',
    properties: {
      kind: {
        type: 'string',
        enum: ['LICENSE_OR_ID', 'ADDITIONAL_ID', 'STUDENT_ID_FRONT', 'STUDENT_ID_BACK'],
      },
      filename: { type: 'string' },
      mimeType: { type: 'string' },
      sizeBytes: { type: 'integer' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  AdminVeterinarianApplicationDocument: {
    allOf: [
      { $ref: '#/components/schemas/VeterinarianApplicationDocument' },
      {
        type: 'object',
        properties: { downloadUrl: { type: 'string', description: 'Short-lived signed GET URL' } },
      },
    ],
  },
  VeterinarianDocumentUploadUrlBody: {
    type: 'object',
    required: ['kind', 'filename', 'mimeType', 'size'],
    properties: {
      kind: {
        type: 'string',
        enum: ['LICENSE_OR_ID', 'ADDITIONAL_ID', 'STUDENT_ID_FRONT', 'STUDENT_ID_BACK'],
      },
      filename: { type: 'string', maxLength: 255 },
      mimeType: { type: 'string' },
      size: { type: 'integer', minimum: 1, maximum: 5 * 1024 * 1024 },
    },
  },
  ApplyBody: {
    type: 'object',
    properties: {
      note: { type: 'string', maxLength: 1000 },
      subType: { type: 'string', enum: ['VETERINARIAN', 'STUDENT'], default: 'VETERINARIAN' },
      documents: {
        type: 'array',
        maxItems: 2,
        items: {
          type: 'object',
          required: ['kind', 'storageKey', 'filename', 'mimeType'],
          properties: {
            kind: {
              type: 'string',
              enum: ['LICENSE_OR_ID', 'ADDITIONAL_ID', 'STUDENT_ID_FRONT', 'STUDENT_ID_BACK'],
            },
            storageKey: { type: 'string', maxLength: 1024 },
            filename: { type: 'string', maxLength: 255 },
            mimeType: { type: 'string' },
          },
        },
      },
    },
  },
  LoginRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string' },
    },
  },
  RefreshRequest: {
    type: 'object',
    required: ['refreshToken'],
    properties: { refreshToken: { type: 'string' } },
  },
  LogoutRequest: {
    type: 'object',
    properties: { refreshToken: { type: 'string' } },
  },
  Role: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      key: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      isSystem: { type: 'boolean' },
      permissions: { type: 'array', items: { type: 'string' } },
    },
  },
  Permission: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      key: { type: 'string', example: 'user.read' },
      description: { type: 'string', nullable: true },
    },
  },
  VeterinarianApplication: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      userId: { type: 'string', format: 'uuid' },
      status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
      subType: { type: 'string', enum: ['VETERINARIAN', 'STUDENT'] },
      note: { type: 'string', nullable: true },
      decidedBy: { type: 'string', format: 'uuid', nullable: true },
      decidedAt: { type: 'string', format: 'date-time', nullable: true },
      decisionReason: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      documents: {
        type: 'array',
        items: { $ref: '#/components/schemas/VeterinarianApplicationDocument' },
      },
    },
  },
  SupervisorAssignment: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      userId: { type: 'string', format: 'uuid' },
      domain: {
        type: 'string',
        enum: ['ANIMAL', 'CLINIC', 'STORE', 'CONTENT', 'CONSULTATION', 'INQUIRY'],
      },
      status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
      assignedBy: { type: 'string', format: 'uuid', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  AuditLog: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      actorUserId: { type: 'string', format: 'uuid', nullable: true },
      action: { type: 'string' },
      entityType: { type: 'string' },
      entityId: { type: 'string', format: 'uuid', nullable: true },
      metadata: { type: 'object', additionalProperties: true },
      ip: { type: 'string', nullable: true },
      userAgent: { type: 'string', nullable: true },
      requestId: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
};

// --- paths -------------------------------------------------------------

const paths: Obj = {
  '/users/me/avatar/upload-url': {
    post: {
      tags: ['Users'],
      summary: 'Request a presigned URL to upload a new avatar image',
      description:
        'Authenticated self-service. The server generates the storage key; the client PUTs the ' +
        'bytes directly to storage, then calls `POST /users/me/avatar` to finalize.',
      security: bearer,
      requestBody: bodyOf('AvatarUploadUrlBody'),
      responses: {
        '201': ok('Presigned upload', dataOf({ $ref: '#/components/schemas/PresignedUpload' })),
        ...errs(400, 401, 422, 429),
      },
    },
  },
  '/users/me/avatar': {
    post: {
      tags: ['Users'],
      summary: 'Finalize an uploaded avatar',
      description:
        'Confirms the object exists at `storageKey` (under `users/avatars/`) and re-validates its ' +
        'REAL size / MIME type from the storage HEAD response — client-declared values are never ' +
        'trusted. Replaces any previous avatar (best-effort delete after commit).',
      security: bearer,
      requestBody: bodyOf('FinalizeAvatarBody'),
      responses: {
        '200': ok('Avatar updated', dataOf({ $ref: '#/components/schemas/User' })),
        ...errs(400, 401, 409, 422, 429),
      },
    },
  },
  '/users/{id}': {
    get: {
      tags: ['Users'],
      summary: 'Get a user’s public name summary',
      description:
        'Any authenticated user. Returns only `{ id, firstName, lastName, veterinarianStatus }` — ' +
        'for resolving authorship / actor ids (e.g. `recordedByUserId`, `createdByUserId`, ' +
        '`transferredBy`) and member / supervisor pickers. A DEACTIVATED account returns 404.',
      security: bearer,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': ok('User summary', dataOf({ $ref: '#/components/schemas/UserSummary' })),
        ...errs(401, 404, 422),
      },
    },
  },
  '/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Register a new account (granted the PET_OWNER role)',
      description:
        'Public. The server controls role assignment — any client-supplied role is ignored.',
      requestBody: bodyOf('RegisterRequest'),
      responses: {
        '201': ok(
          'Account created',
          dataOf({
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
              tokens: { $ref: '#/components/schemas/Tokens' },
            },
          }),
        ),
        ...errs(409, 422, 429),
      },
    },
  },
  '/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Exchange credentials for an access + refresh token pair',
      description: 'Public. SUSPENDED / DEACTIVATED accounts are rejected with 403.',
      requestBody: bodyOf('LoginRequest'),
      responses: {
        '200': ok(
          'Authenticated',
          dataOf({
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
              tokens: { $ref: '#/components/schemas/Tokens' },
            },
          }),
        ),
        ...errs(401, 403, 422, 429),
      },
    },
  },
  '/auth/refresh': {
    post: {
      tags: ['Auth'],
      summary: 'Rotate the refresh token and issue a new access token',
      description:
        'Public. Refresh tokens are single-use: the presented token is revoked and a new one returned. Presenting an already-used token revokes every session for that user.',
      requestBody: bodyOf('RefreshRequest'),
      responses: {
        '200': ok(
          'Rotated',
          dataOf({
            type: 'object',
            properties: { tokens: { $ref: '#/components/schemas/Tokens' } },
          }),
        ),
        ...errs(401, 422, 429),
      },
    },
  },
  '/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: 'Revoke the current session',
      security: bearer,
      requestBody: bodyOf('LogoutRequest'),
      responses: { '200': ok('Session revoked'), ...errs(401) },
    },
  },
  '/auth/logout-all': {
    post: {
      tags: ['Auth'],
      summary: 'Revoke every session for the current user',
      security: bearer,
      responses: { '200': ok('All sessions revoked'), ...errs(401) },
    },
  },
  '/auth/me': {
    get: {
      tags: ['Auth'],
      summary: 'Current identity, roles, effective permissions and supervisor domains',
      security: bearer,
      responses: {
        '200': ok(
          'Current user context',
          dataOf({
            type: 'object',
            properties: {
              user: { $ref: '#/components/schemas/User' },
              roles: { type: 'array', items: { type: 'string' } },
              permissions: { type: 'array', items: { type: 'string' } },
              isAdmin: { type: 'boolean' },
              supervisorDomains: { type: 'array', items: { type: 'string' } },
              veterinarian: {
                type: 'object',
                properties: { status: { type: 'string' }, approved: { type: 'boolean' } },
              },
            },
          }),
        ),
        ...errs(401),
      },
    },
  },

  '/veterinarians/apply': {
    post: {
      tags: ['Veterinarians'],
      summary: 'Apply to become a veterinarian (moves status to PENDING)',
      description:
        'A VETERINARIAN application requires a `LICENSE_OR_ID` document (an `ADDITIONAL_ID` is ' +
        'optional); a STUDENT application requires both `STUDENT_ID_FRONT` and `STUDENT_ID_BACK`. ' +
        'Each `documents[].storageKey` must come from `POST /veterinarians/documents/upload-url` ' +
        'and have an object actually uploaded at it — the server re-validates the real size/MIME ' +
        'from storage before accepting the application.',
      security: bearer,
      requestBody: {
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplyBody' } } },
      },
      responses: {
        '201': ok(
          'Application submitted',
          dataOf({ $ref: '#/components/schemas/VeterinarianApplication' }),
        ),
        ...errs(400, 401, 409, 422, 429),
      },
    },
  },
  '/veterinarians/documents/upload-url': {
    post: {
      tags: ['Veterinarians'],
      summary: 'Request a presigned URL to upload an application identity document',
      security: bearer,
      requestBody: bodyOf('VeterinarianDocumentUploadUrlBody'),
      responses: {
        '201': ok('Presigned upload', dataOf({ $ref: '#/components/schemas/PresignedUpload' })),
        ...errs(400, 401, 422, 429),
      },
    },
  },
  '/veterinarians/me/status': {
    get: {
      tags: ['Veterinarians'],
      summary: 'Current veterinarian status and latest application',
      security: bearer,
      responses: { '200': ok('Status'), ...errs(401) },
    },
  },
  '/admin/veterinarians/pending': {
    get: {
      tags: ['Admin · Veterinarians'],
      summary: 'List pending veterinarian applications',
      description:
        'Requires `veterinarian.read`. Each application includes `subType` and `documents[]` with ' +
        'a short-lived signed `downloadUrl` per document, so a reviewer can inspect the submitted ' +
        'identity documents without a separate admin file-browsing route.',
      security: bearer,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
      ],
      responses: {
        '200': ok(
          'Paginated applications',
          dataOf({
            type: 'array',
            items: {
              allOf: [
                { $ref: '#/components/schemas/VeterinarianApplication' },
                {
                  type: 'object',
                  properties: {
                    documents: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/AdminVeterinarianApplicationDocument' },
                    },
                  },
                },
              ],
            },
          }),
        ),
        ...errs(401, 403),
      },
    },
  },
  '/admin/veterinarians/{userId}/approve': {
    post: {
      tags: ['Admin · Veterinarians'],
      summary: 'Approve an application (grants the VETERINARIAN role)',
      description:
        'Requires `veterinarian.approve`. An admin cannot approve their own application.',
      security: bearer,
      parameters: [
        { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': ok('Approved', dataOf({ $ref: '#/components/schemas/VeterinarianApplication' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/veterinarians/{userId}/reject': {
    post: {
      tags: ['Admin · Veterinarians'],
      summary: 'Reject an application',
      description: 'Requires `veterinarian.reject`. A reason is mandatory.',
      security: bearer,
      parameters: [
        { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
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
      responses: {
        '200': ok('Rejected', dataOf({ $ref: '#/components/schemas/VeterinarianApplication' })),
        ...errs(401, 403, 404, 422),
      },
    },
  },

  '/admin/users': {
    get: {
      tags: ['Admin · Users'],
      summary: 'List users',
      description: 'Requires `user.read`.',
      security: bearer,
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer' } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer' } },
        {
          name: 'status',
          in: 'query',
          schema: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] },
        },
        { name: 'veterinarianStatus', in: 'query', schema: { type: 'string' } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
      ],
      responses: { '200': ok('Paginated users'), ...errs(401, 403) },
    },
    post: {
      tags: ['Admin · Users'],
      summary: 'Create a user with an explicit set of roles',
      description: 'Requires `user.create` (and `role.assign` semantics for the `roles` field).',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'password', 'firstName', 'lastName'],
              properties: {
                email: { type: 'string', format: 'email' },
                password: { type: 'string', minLength: 10 },
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                phone: { type: 'string' },
                roles: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: ['ADMIN', 'MODERATOR', 'PET_OWNER', 'VETERINARIAN'],
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        '201': ok('User created', dataOf({ $ref: '#/components/schemas/User' })),
        ...errs(401, 403, 409, 422),
      },
    },
  },
  '/admin/users/{id}': {
    get: {
      tags: ['Admin · Users'],
      summary: 'Get a user (with roles)',
      description: 'Requires `user.read`.',
      security: bearer,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': ok('User', dataOf({ $ref: '#/components/schemas/User' })),
        ...errs(401, 403, 404),
      },
    },
    patch: {
      tags: ['Admin · Users'],
      summary: 'Update profile fields (firstName / lastName / phone)',
      description: 'Requires `user.update`.',
      security: bearer,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                phone: { type: 'string', nullable: true },
              },
            },
          },
        },
      },
      responses: {
        '200': ok('Updated', dataOf({ $ref: '#/components/schemas/User' })),
        ...errs(401, 403, 404, 422),
      },
    },
  },
  '/admin/users/{id}/suspend': {
    post: {
      tags: ['Admin · Users'],
      summary: 'Suspend a user (revokes their sessions)',
      description: 'Requires `user.suspend`. You cannot suspend yourself.',
      security: bearer,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': ok('Suspended', dataOf({ $ref: '#/components/schemas/User' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/users/{id}/activate': {
    post: {
      tags: ['Admin · Users'],
      summary: 'Re-activate a user',
      description: 'Requires `user.activate`.',
      security: bearer,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': ok('Activated', dataOf({ $ref: '#/components/schemas/User' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/users/{id}/deactivate': {
    post: {
      tags: ['Admin · Users'],
      summary: 'Deactivate a user (revokes their sessions)',
      description: 'Requires `user.deactivate`. You cannot deactivate yourself.',
      security: bearer,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': ok('Deactivated', dataOf({ $ref: '#/components/schemas/User' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/users/{id}/roles': {
    post: {
      tags: ['Admin · Users'],
      summary: 'Assign a global role to a user',
      description: 'Requires `role.assign`.',
      security: bearer,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['roleKey'],
              properties: {
                roleKey: {
                  type: 'string',
                  enum: ['ADMIN', 'MODERATOR', 'PET_OWNER', 'VETERINARIAN'],
                },
              },
            },
          },
        },
      },
      responses: { '200': ok('Roles after change'), ...errs(401, 403, 404, 409) },
    },
  },
  '/admin/users/{id}/roles/{roleKey}': {
    delete: {
      tags: ['Admin · Users'],
      summary: 'Remove a global role from a user',
      description:
        'Requires `role.assign`. You cannot remove your own ADMIN role, nor the last ADMIN.',
      security: bearer,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'roleKey', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: { '200': ok('Roles after change'), ...errs(401, 403, 404, 409) },
    },
  },

  '/admin/roles': {
    get: {
      tags: ['Admin · Roles & Permissions'],
      summary: 'List roles with their permissions',
      description: 'Requires `role.read`.',
      security: bearer,
      responses: {
        '200': ok('Roles', dataOf({ type: 'array', items: { $ref: '#/components/schemas/Role' } })),
        ...errs(401, 403),
      },
    },
  },
  '/admin/roles/{key}': {
    get: {
      tags: ['Admin · Roles & Permissions'],
      summary: 'Get one role with its permissions',
      description: 'Requires `role.read`.',
      security: bearer,
      parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        '200': ok('Role', dataOf({ $ref: '#/components/schemas/Role' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/roles/{key}/permissions': {
    post: {
      tags: ['Admin · Roles & Permissions'],
      summary: 'Attach a permission to a role',
      description:
        'Requires `permission.assign`. The ADMIN role cannot be modified (it uses the override).',
      security: bearer,
      parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['permissionKey'],
              properties: { permissionKey: { type: 'string' } },
            },
          },
        },
      },
      responses: {
        '200': ok('Role', dataOf({ $ref: '#/components/schemas/Role' })),
        ...errs(400, 401, 403, 404, 409),
      },
    },
  },
  '/admin/roles/{key}/permissions/{permissionKey}': {
    delete: {
      tags: ['Admin · Roles & Permissions'],
      summary: 'Detach a permission from a role',
      description: 'Requires `permission.assign`.',
      security: bearer,
      parameters: [
        { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'permissionKey', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        '200': ok('Role', dataOf({ $ref: '#/components/schemas/Role' })),
        ...errs(401, 403, 404),
      },
    },
  },
  '/admin/permissions': {
    get: {
      tags: ['Admin · Roles & Permissions'],
      summary: 'List all permissions',
      description: 'Requires `permission.read`.',
      security: bearer,
      responses: {
        '200': ok(
          'Permissions',
          dataOf({ type: 'array', items: { $ref: '#/components/schemas/Permission' } }),
        ),
        ...errs(401, 403),
      },
    },
  },

  '/admin/supervisors': {
    get: {
      tags: ['Admin · Supervisors'],
      summary: 'List system supervisor assignments',
      description: 'Requires `supervisor.read`.',
      security: bearer,
      parameters: [
        { name: 'domain', in: 'query', schema: { type: 'string' } },
        { name: 'userId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] } },
      ],
      responses: { '200': ok('Paginated assignments'), ...errs(401, 403) },
    },
    post: {
      tags: ['Admin · Supervisors'],
      summary: 'Assign a user as system supervisor for a domain',
      description: 'Requires `supervisor.assign`. You cannot assign yourself.',
      security: bearer,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['userId', 'domain'],
              properties: {
                userId: { type: 'string', format: 'uuid' },
                domain: {
                  type: 'string',
                  enum: ['ANIMAL', 'CLINIC', 'STORE', 'CONTENT', 'CONSULTATION', 'INQUIRY'],
                },
              },
            },
          },
        },
      },
      responses: {
        '201': ok('Assigned', dataOf({ $ref: '#/components/schemas/SupervisorAssignment' })),
        ...errs(401, 403, 404, 409, 422),
      },
    },
  },
  '/admin/supervisors/{id}': {
    delete: {
      tags: ['Admin · Supervisors'],
      summary: 'Deactivate a supervisor assignment',
      description: 'Requires `supervisor.remove`.',
      security: bearer,
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        '200': ok('Deactivated', dataOf({ $ref: '#/components/schemas/SupervisorAssignment' })),
        ...errs(401, 403, 404),
      },
    },
  },

  '/admin/audit-logs': {
    get: {
      tags: ['Admin · Audit'],
      summary: 'Read the audit log (newest first)',
      description: 'Requires `audit.read`.',
      security: bearer,
      parameters: [
        { name: 'action', in: 'query', schema: { type: 'string' } },
        { name: 'entityType', in: 'query', schema: { type: 'string' } },
        { name: 'entityId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'actorUserId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
      ],
      responses: {
        '200': ok(
          'Paginated audit entries',
          dataOf({ type: 'array', items: { $ref: '#/components/schemas/AuditLog' } }),
        ),
        ...errs(401, 403),
      },
    },
  },
};

const tags = [
  { name: 'Auth', description: 'Registration, login, token lifecycle' },
  { name: 'Users', description: 'Authenticated user directory (name-level summary)' },
  { name: 'Veterinarians', description: 'Veterinarian approval workflow (applicant side)' },
  { name: 'Admin · Users', description: 'Account management' },
  { name: 'Admin · Roles & Permissions', description: 'Global RBAC management' },
  { name: 'Admin · Veterinarians', description: 'Veterinarian approval (reviewer side)' },
  { name: 'Admin · Supervisors', description: 'System supervisor assignments' },
  { name: 'Admin · Audit', description: 'Audit log' },
];

const securitySchemes = {
  bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
};

export const phase2OpenApi = { tags, paths, schemas, securitySchemes };
