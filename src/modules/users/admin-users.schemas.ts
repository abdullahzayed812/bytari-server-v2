import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http/pagination.js';
import {
  emailSchema,
  nameSchema,
  passwordSchema,
  phoneSchema,
} from '../../shared/validation/common.js';
import { countryCodeSchema, governorateSchema } from '../../shared/validation/geography.js';
import { ROLE_KEYS } from '../rbac/rbac.constants.js';
import { ACCOUNT_TYPES, GENDERS, USER_STATUSES, VETERINARIAN_STATUSES } from './user.types.js';

export const listUsersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(USER_STATUSES).optional(),
  veterinarianStatus: z.enum(VETERINARIAN_STATUSES).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  /** Narrow to users holding this global role key (raw RBAC filter). */
  role: z.enum(ROLE_KEYS).optional(),
  /**
   * Admin "Pet Owners" / "Veterinarians" pages — mutually exclusive audiences
   * (see `ACCOUNT_TYPES`); a raw `role=PET_OWNER` also matches veterinarians.
   */
  accountType: z.enum(ACCOUNT_TYPES).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const createUserBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  phone: phoneSchema.optional(),
  roles: z.array(z.enum(ROLE_KEYS)).max(ROLE_KEYS.length).optional(),
});
export type CreateUserBody = z.infer<typeof createUserBodySchema>;

/**
 * Admin profile edit — an explicit allow-list (`.strict()`): status, roles,
 * veterinarian/trader status, avatar and password are NOT writable here (each
 * has its own audited endpoint), so no protected field can be mass-assigned.
 */
export const updateUserBodySchema = z
  .object({
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    phone: phoneSchema.nullable().optional(),
    email: emailSchema.optional(),
    gender: z.enum(GENDERS).nullable().optional(),
    country: countryCodeSchema.nullable().optional(),
    governorate: governorateSchema.nullable().optional(),
    specialization: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;

export const statusChangeBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type StatusChangeBody = z.infer<typeof statusChangeBodySchema>;

export const assignRoleBodySchema = z.object({
  roleKey: z.enum(ROLE_KEYS),
});
export type AssignRoleBody = z.infer<typeof assignRoleBodySchema>;

export const roleKeyParamSchema = z.object({
  id: z.string().uuid(),
  roleKey: z.enum(ROLE_KEYS),
});

/** `POST /admin/users/:id/password` — the admin chooses the new password (never read back). */
export const adminSetPasswordBodySchema = z.object({ newPassword: passwordSchema }).strict();
export type AdminSetPasswordBody = z.infer<typeof adminSetPasswordBodySchema>;

/** `POST /admin/users/:id/messages` — opens a support thread owned by the user. */
export const adminMessageUserBodySchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
    /** Photos uploaded first via `POST /support-messages/attachments/upload-url`. */
    imageKeys: z.array(z.string().trim().min(1).max(1024)).max(4).optional(),
  })
  .strict();
export type AdminMessageUserBody = z.infer<typeof adminMessageUserBodySchema>;
