import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const idParamSchema = z.object({ id: z.string().uuid() });
export const userIdParamSchema = z.object({ userId: z.string().uuid() });

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128);
export const nameSchema = z.string().trim().min(1).max(100);
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s\-()]{5,23}$/, 'Invalid phone number');
