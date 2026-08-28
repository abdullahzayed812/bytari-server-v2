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

export const updateOrganizationBodySchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateOrganizationBody = z.infer<typeof updateOrganizationBodySchema>;

export const listMyOrganizationsQuerySchema = paginationQuerySchema;
export type ListMyOrganizationsQuery = z.infer<typeof listMyOrganizationsQuerySchema>;

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

export const addMemberBodySchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['VETERINARIAN', 'STAFF']),
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
