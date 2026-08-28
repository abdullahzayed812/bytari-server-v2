import { z } from 'zod';
import { PERMISSION_KEYS, ROLE_KEYS } from './rbac.constants.js';

export const roleKeyParamSchema = z.object({ key: z.enum(ROLE_KEYS) });

export const rolePermissionParamSchema = z.object({
  key: z.enum(ROLE_KEYS),
  permissionKey: z.enum(PERMISSION_KEYS),
});

export const addPermissionBodySchema = z.object({
  permissionKey: z.enum(PERMISSION_KEYS),
});
export type AddPermissionBody = z.infer<typeof addPermissionBodySchema>;
