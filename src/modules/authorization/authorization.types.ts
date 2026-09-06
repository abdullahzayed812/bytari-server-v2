/**
 * The minimal identity context the authorization layer reasons about. Built by
 * the `authenticate` middleware from the verified access token + the user row.
 *
 * Kept deliberately small and structural so future organisation-scoped checks
 * can extend it (e.g. an `organizationMemberships` field) without a rewrite.
 */
export interface AuthPrincipal {
  userId: string;
  email: string;
  status: string;
  veterinarianStatus: string;
  traderStatus: string;
  roleKeys: string[];
  sessionId: string | null;
}
