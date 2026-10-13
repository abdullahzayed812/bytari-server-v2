/**
 * OpenAPI fragment for the admin-managed home-page section images — one
 * optional image per EXISTING bottom section card of the Pet Owner /
 * Veterinarian home pages. Reads need only authentication; writes require
 * `home_section.manage` (ADMIN override only). Images use the shared
 * presigned-R2 flow: request an upload URL → PUT → register.
 */
type Obj = Record<string, unknown>;

const bearer = [{ bearerAuth: [] }];
const jsonError = {
  'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
};

function errs(...codes: number[]): Obj {
  const map: Record<number, string> = {
    400: 'Bad image (size / type / storage key not from this section’s upload URL)',
    401: 'Missing or invalid access token',
    403: 'Authenticated but lacks home_section.manage',
    422: 'Request failed validation (unknown section key, bad body)',
  };
  const out: Obj = {};
  for (const c of codes) out[String(c)] = { description: map[c] ?? 'Error', content: jsonError };
  return out;
}
function ok(description: string, schema: Obj): Obj {
  return { description, content: { 'application/json': { schema } } };
}
function dataOf(schema: Obj): Obj {
  return { type: 'object', properties: { data: schema } };
}

const sectionKeyEnum = [
  'PET_OWNER_PETS',
  'PET_OWNER_LIVESTOCK',
  'PET_OWNER_POULTRY',
  'VET_CHAT',
  'VET_SERVICES',
  'VET_MAGAZINE',
  'VET_BOOKS',
];
const keyParam = {
  name: 'key',
  in: 'path',
  required: true,
  schema: { type: 'string', enum: sectionKeyEnum },
};
const imageMime = { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] };

const schemas: Obj = {
  HomeSectionImage: {
    type: 'object',
    properties: {
      key: { type: 'string', enum: sectionKeyEnum },
      page: { type: 'string', enum: ['PET_OWNER_HOME', 'VETERINARIAN_HOME'] },
      imageUrl: {
        type: 'string',
        nullable: true,
        description: 'null = no image configured; the app shows its built-in icon.',
      },
      updatedAt: { type: 'string', format: 'date-time', nullable: true },
    },
  },
};

const T = ['Home sections'];
const tags = [
  {
    name: 'Home sections',
    description: 'Admin-managed images for the existing home-page section cards',
  },
];

const list = dataOf({ type: 'array', items: { $ref: '#/components/schemas/HomeSectionImage' } });
const one = dataOf({ $ref: '#/components/schemas/HomeSectionImage' });

const paths: Obj = {
  '/home-sections': {
    get: {
      tags: T,
      summary: 'Every home section with its image (or null) — any authenticated user',
      security: bearer,
      responses: { 200: ok('Sections', list), ...errs(401) },
    },
  },
  '/admin/home-sections': {
    get: {
      tags: T,
      summary: 'Admin list of home sections — home_section.manage',
      security: bearer,
      responses: { 200: ok('Sections', list), ...errs(401, 403) },
    },
  },
  '/admin/home-sections/{key}/image/upload-url': {
    post: {
      tags: T,
      summary: 'Presigned PUT URL for a section image — home_section.manage',
      security: bearer,
      parameters: [keyParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['filename', 'mimeType', 'size'],
              properties: {
                filename: { type: 'string', maxLength: 255 },
                mimeType: imageMime,
                size: { type: 'integer', minimum: 1, maximum: 10485760 },
              },
            },
          },
        },
      },
      responses: {
        200: ok(
          'Upload URL',
          dataOf({
            type: 'object',
            properties: {
              storageKey: { type: 'string' },
              uploadUrl: { type: 'string' },
              method: { type: 'string', enum: ['PUT'] },
              headers: { type: 'object' },
              expiresInSeconds: { type: 'integer' },
            },
          }),
        ),
        ...errs(400, 401, 403, 422),
      },
    },
  },
  '/admin/home-sections/{key}/image': {
    post: {
      tags: T,
      summary: 'Attach / replace the section image after upload — home_section.manage',
      security: bearer,
      parameters: [keyParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['storageKey', 'mimeType'],
              properties: { storageKey: { type: 'string' }, mimeType: imageMime },
            },
          },
        },
      },
      responses: { 200: ok('Updated', one), ...errs(400, 401, 403, 422) },
    },
    delete: {
      tags: T,
      summary: 'Remove the section image (back to the built-in icon) — home_section.manage',
      security: bearer,
      parameters: [keyParam],
      responses: { 200: ok('Removed', one), ...errs(401, 403, 422) },
    },
  },
};

export const homeSectionsOpenApi = { tags, paths, schemas };
