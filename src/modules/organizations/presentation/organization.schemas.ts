import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/http/pagination.js';
import { ORG_PERMISSION_KEYS } from '../domain/organization-rbac.constants.js';
import {
  MEMBERSHIP_STATUSES,
  ORGANIZATION_STATUSES,
  ORGANIZATION_TYPES,
} from '../domain/organization.types.js';

// --- organization ----------------------------------------------------

export const createOrganizationBodySchema = z.object({
  type: z.enum(ORGANIZATION_TYPES),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional(),
});
export type CreateOrganizationBody = z.infer<typeof createOrganizationBodySchema>;

const latitude = z.coerce.number().min(-90).max(90);
const longitude = z.coerce.number().min(-180).max(180);
/** Trimmed, `''` → `null` (so clearing a field via an empty input just works). */
const optionalUrl = z.string().trim().max(300).url().nullable().optional();
const optionalText = (max: number): z.ZodOptional<z.ZodNullable<z.ZodString>> =>
  z.string().trim().min(1).max(max).nullable().optional();

export const updateOrganizationBodySchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    // Profile fields — CLINIC / VETERINARY_OFFICE / VETERINARY_STORE only
    // (`OrganizationPolicy.assertHasProfileFields`, enforced in the service).
    address: z.string().trim().min(1).max(500).nullable().optional(),
    phone: z.string().trim().min(3).max(40).nullable().optional(),
    latitude: latitude.nullable().optional(),
    longitude: longitude.nullable().optional(),
    workingHours: optionalText(200),
    services: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    email: z.string().trim().max(255).email().nullable().optional(),
    whatsapp: optionalText(40),
    instagramUrl: optionalUrl,
    facebookUrl: optionalUrl,
    tiktokUrl: optionalUrl,
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' })
  .refine((v) => (v.latitude == null) === (v.longitude == null), {
    message: 'latitude and longitude must be provided together',
    path: ['latitude'],
  });
export type UpdateOrganizationBody = z.infer<typeof updateOrganizationBodySchema>;

export const listMyOrganizationsQuerySchema = paginationQuerySchema;
export type ListMyOrganizationsQuery = z.infer<typeof listMyOrganizationsQuerySchema>;

/**
 * `GET /organizations/discover` — any authenticated user, ACTIVE organizations
 * only. `sort=nearest` requires both `lat` and `lng`; distance is computed and
 * ordered server-side (see `OrganizationRepository.discoverWithDetails`) — the
 * client never computes distance itself.
 */
export const discoverOrganizationsQuerySchema = paginationQuerySchema
  .extend({
    type: z.enum(ORGANIZATION_TYPES).optional(),
    search: z.string().trim().min(1).max(160).optional(),
    sort: z.enum(['default', 'nearest']).optional().default('default'),
    lat: latitude.optional(),
    lng: longitude.optional(),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'lat and lng must be provided together',
    path: ['lat'],
  })
  .refine((v) => v.sort !== 'nearest' || (v.lat !== undefined && v.lng !== undefined), {
    message: 'sort=nearest requires lat and lng',
    path: ['sort'],
  });
export type DiscoverOrganizationsQuery = z.infer<typeof discoverOrganizationsQuerySchema>;

export const logoUploadUrlBodySchema = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((v) => !v.includes('/') && !v.includes('\\'), {
        message: 'filename must not contain path separators',
      }),
    mimeType: z.string().trim().min(1).max(255),
    size: z
      .number()
      .int()
      .positive()
      .max(5 * 1024 * 1024),
  })
  .strict();
export type LogoUploadUrlBody = z.infer<typeof logoUploadUrlBodySchema>;

export const finalizeLogoBodySchema = z
  .object({
    storageKey: z.string().trim().min(1).max(1024),
    mimeType: z.string().trim().min(1).max(255),
  })
  .strict();
export type FinalizeLogoBody = z.infer<typeof finalizeLogoBodySchema>;

/** Same shape as the logo upload flow — one gallery photo at a time. */
export const galleryUploadUrlBodySchema = logoUploadUrlBodySchema;
export type GalleryUploadUrlBody = z.infer<typeof galleryUploadUrlBodySchema>;

export const finalizeGalleryBodySchema = finalizeLogoBodySchema;
export type FinalizeGalleryBody = z.infer<typeof finalizeGalleryBodySchema>;

export const removeGalleryImageQuerySchema = z.object({
  storageKey: z.string().trim().min(1).max(1024),
});
export type RemoveGalleryImageQuery = z.infer<typeof removeGalleryImageQuerySchema>;

// --- engagement: follow + reviews (Clinic Details) --------------------

export const submitReviewBodySchema = z
  .object({
    rating: z.coerce.number().int().min(1).max(5),
    comment: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();
export type SubmitReviewBody = z.infer<typeof submitReviewBodySchema>;

export const listReviewsQuerySchema = paginationQuerySchema;
export type ListReviewsQuery = z.infer<typeof listReviewsQuerySchema>;

// --- admin -----------------------------------------------------------

export const adminListOrganizationsQuerySchema = paginationQuerySchema.extend({
  type: z.enum(ORGANIZATION_TYPES).optional(),
  status: z.enum(ORGANIZATION_STATUSES).optional(),
  ownerUserId: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(160).optional(),
});
export type AdminListOrganizationsQuery = z.infer<typeof adminListOrganizationsQuerySchema>;

export const rejectOrganizationBodySchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});
export type RejectOrganizationBody = z.infer<typeof rejectOrganizationBodySchema>;

/** Tolerates a completely absent request body (all fields optional). */
export const statusChangeBodySchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .default({});
export type StatusChangeBody = z.infer<typeof statusChangeBodySchema>;

// --- members -------------------------------------------------------

export const listMembersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
  roleKey: z.enum(['OWNER', 'VETERINARIAN', 'SUPERVISOR', 'STAFF']).optional(),
});
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;

export const addMemberBodySchema = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    role: z.enum(['VETERINARIAN', 'STAFF']),
  })
  .refine((v) => Boolean(v.userId) !== Boolean(v.email), {
    message: 'Provide exactly one of userId or email',
    path: ['userId'],
  });
export type AddMemberBody = z.infer<typeof addMemberBodySchema>;

export const updateMemberBodySchema = z
  .object({
    role: z.enum(['VETERINARIAN', 'STAFF']).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateMemberBody = z.infer<typeof updateMemberBodySchema>;

export const organizationMemberParamSchema = z.object({
  organizationId: z.string().uuid(),
  memberId: z.string().uuid(),
});

// --- supervisors -------------------------------------------------

export const assignSupervisorBodySchema = z.object({
  userId: z.string().uuid(),
  permissions: z.array(z.enum(ORG_PERMISSION_KEYS)).max(ORG_PERMISSION_KEYS.length),
});
export type AssignSupervisorBody = z.infer<typeof assignSupervisorBodySchema>;

export const updateSupervisorBodySchema = z.object({
  permissions: z.array(z.enum(ORG_PERMISSION_KEYS)).max(ORG_PERMISSION_KEYS.length),
});
export type UpdateSupervisorBody = z.infer<typeof updateSupervisorBodySchema>;

export const organizationSupervisorParamSchema = z.object({
  organizationId: z.string().uuid(),
  membershipId: z.string().uuid(),
});
