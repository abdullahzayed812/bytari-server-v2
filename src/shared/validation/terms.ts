import { z } from 'zod';

/**
 * Registration Terms & Conditions acceptance fields — shared by every
 * organization-creating body (clinic / office registration, poultry / sheep /
 * cattle farm forms). Optional at the schema level: WHICH organizations
 * require it is decided by `OrganizationService.create` (`termsKeyFor`).
 */
export const termsAcceptanceShape = {
  termsAccepted: z.boolean().optional(),
  /** The `version` of the terms the user was shown (`GET /organizations/terms/:key`). */
  termsVersion: z.string().trim().min(1).max(64).optional(),
};
