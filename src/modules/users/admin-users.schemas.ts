import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http/pagination.js';
import {
  emailSchema,
  nameSchema,
  passwordSchema,
  phoneSchema,
} from '../../shared/validation/common.js';
import { ROLE_KEYS } from '../rbac/rbac.constants.js';
import { USER_STATUSES, VETERINARIAN_STATUSES } from './user.types.js';

export const listUsersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(USER_STATUSES).optional(),
  veterinarianStatus: z.enum(VETERINARIAN_STATUSES).optional(),
  search: z.string().trim().min(1).max(120).optional(),
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

export const updateUserBodySchema = z
  .object({
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    phone: phoneSchema.nullable().optional(),
  })
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
