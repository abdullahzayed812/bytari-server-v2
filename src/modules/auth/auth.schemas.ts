import { z } from 'zod';
import { REGISTRATION_TYPES } from '../users/user.types.js';
import {
  emailSchema,
  nameSchema,
  passwordSchema,
  phoneSchema,
} from '../../shared/validation/common.js';
import {
  countryCodeSchema,
  governorateSchema,
  isValidGovernorate,
} from '../../shared/validation/geography.js';

// Not `.strict()` — unknown / privileged keys (e.g. a client-supplied `role`)
// are silently stripped rather than rejected, matching the existing contract.
export const registerBodySchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    firstName: nameSchema,
    /** Father's or family name — UI label "اسم الأب أو العائلة". */
    lastName: nameSchema,
    /** Required for every self-registration (was optional). */
    phone: phoneSchema,
    gender: z.enum(['MALE', 'FEMALE']).optional(),
    country: countryCodeSchema.optional(),
    /** Governorate / state within `country`; only meaningful with a country. */
    governorate: governorateSchema.optional(),
    /** Optional veterinarian specialization ("التخصص"); ignored for Pet Owners. */
    specialization: z.string().trim().min(1).max(150).optional(),
    /**
     * Which onboarding path: `PET_OWNER` (default) → email verification;
     * `VETERINARIAN` → no email verification, admin approval instead. Choosing
     * VETERINARIAN only ever RESTRICTS the account (it stays gated until an
     * admin approves), so trusting the client's choice grants nothing.
     */
    accountType: z.enum(REGISTRATION_TYPES).default('PET_OWNER'),
  })
  .superRefine((v, ctx) => {
    if (v.governorate !== undefined && v.country === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['country'],
        message: 'country is required when a governorate is given',
      });
    }
    if (v.country !== undefined && v.governorate === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['governorate'],
        message: 'governorate is required once a country is selected',
      });
    }
    if (
      v.country !== undefined &&
      v.governorate !== undefined &&
      !isValidGovernorate(v.country, v.governorate)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['governorate'],
        message: 'governorate is not valid for the selected country',
      });
    }
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

/** Exactly 6 digits — matches `EmailVerificationService`'s generated code shape. */
const verificationCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'code must be exactly 6 digits');

export const verifyEmailBodySchema = z.object({
  email: emailSchema,
  code: verificationCode,
});
export type VerifyEmailBody = z.infer<typeof verifyEmailBodySchema>;

export const resendVerificationBodySchema = z.object({
  email: emailSchema,
});
export type ResendVerificationBody = z.infer<typeof resendVerificationBodySchema>;

export const forgotPasswordBodySchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;

export const resetPasswordBodySchema = z.object({
  email: emailSchema,
  code: verificationCode,
  newPassword: passwordSchema,
});
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;
