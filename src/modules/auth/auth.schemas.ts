import { z } from 'zod';
import {
  emailSchema,
  nameSchema,
  passwordSchema,
  phoneSchema,
} from '../../shared/validation/common.js';

export const registerBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  phone: phoneSchema.optional(),
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(20).max(512),
});
export type RefreshBody = z.infer<typeof refreshBodySchema>;

export const logoutBodySchema = z.object({
  refreshToken: z.string().min(20).max(512).optional(),
});
export type LogoutBody = z.infer<typeof logoutBodySchema>;
