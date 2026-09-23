/**
 * `PENDING_VERIFICATION` — a self-registered account whose email has not been
 * confirmed yet (`EmailVerificationService`). It is NOT usable for normal
 * application access: `AuthService.login()` refuses it (403
 * `EMAIL_VERIFICATION_REQUIRED`, no tokens issued) and the default
 * `authenticate` middleware blocks it on every route except the small,
 * explicit self-service allowlist (`createAuthenticate({ allowPending: true
 * })`) a freshly-registered user needs to finish registering — see
 * `authenticate.middleware.ts`. Accounts never reach this state any other way
 * (admin-created users and dev-seed personas are always inserted `ACTIVE`).
 */
export const USER_STATUSES = ['ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED', 'DEACTIVATED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const VETERINARIAN_STATUSES = ['NOT_APPLIED', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type VeterinarianStatus = (typeof VETERINARIAN_STATUSES)[number];

export const TRADER_STATUSES = [
  'NOT_REGISTERED',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
] as const;
export type TraderStatus = (typeof TRADER_STATUSES)[number];

/** Which self-registration path created the account — see migration `20261023010000_user_registration_type`. */
export const REGISTRATION_TYPES = ['PET_OWNER', 'VETERINARIAN'] as const;
export type RegistrationType = (typeof REGISTRATION_TYPES)[number];

export const GENDERS = ['MALE', 'FEMALE'] as const;
export type Gender = (typeof GENDERS)[number];

/** Full user aggregate, including the password hash. Never leaves the service layer. */
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  gender: Gender | null;
  /** ISO 3166-1 alpha-2, uppercase. */
  country: string | null;
  /** Object-storage key of the avatar image, or `null`. */
  avatarKey: string | null;
  status: UserStatus;
  veterinarianStatus: VeterinarianStatus;
  traderStatus: TraderStatus;
  registrationType: RegistrationType;
  createdAt: Date;
  updatedAt: Date;
}

/** Client-safe user shape. No password hash. */
export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  gender: Gender | null;
  country: string | null;
  /**
   * Client-usable avatar URL — the public CDN URL when the bucket is public,
   * else a short-lived signed GET URL. The raw R2 key (`User.avatarKey`) is
   * deliberately NOT exposed: storage keys never leave the server.
   */
  avatarUrl: string | null;
  status: UserStatus;
  veterinarianStatus: VeterinarianStatus;
  traderStatus: TraderStatus;
  registrationType: RegistrationType;
  createdAt: string;
  updatedAt: string;
}

/**
 * Minimal directory projection any authenticated user may read for a given user
 * id (`GET /users/:id`). Deliberately name-only — no email, phone, account
 * status, roles or timestamps — so it is safe to expose for resolving the
 * authorship / actor UUIDs that other DTOs already carry (medical-record
 * `recordedByUserId`, poultry / product `createdByUserId`, publication
 * `reviewedByUserId`, ownership `transferredBy`, …) and for member / supervisor
 * pickers. Matches the `{ id, firstName, lastName }` shape the organization
 * membership and animal-ownership DTOs already return via a `users` join.
 */
export interface UserSummary {
  id: string;
  firstName: string;
  lastName: string;
  veterinarianStatus: VeterinarianStatus;
  traderStatus: TraderStatus;
  /** Same resolution rule as {@link PublicUser.avatarUrl}; never the raw key. */
  avatarUrl: string | null;
}

export interface CreateUserData {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  gender?: Gender | null;
  country?: string | null;
  /**
   * Defaults to the DB column default (`ACTIVE`) when omitted — every caller
   * except `AuthService.register()` (which explicitly passes
   * `PENDING_VERIFICATION`) relies on that default.
   */
  status?: UserStatus;
  /** Defaults to the column default (`PET_OWNER`). */
  registrationType?: RegistrationType;
}

export interface UpdateUserData {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  gender?: Gender | null;
  country?: string | null;
  avatarKey?: string | null;
  status?: UserStatus;
  veterinarianStatus?: VeterinarianStatus;
  traderStatus?: TraderStatus;
  passwordHash?: string;
}

export interface ListUsersFilter {
  page: number;
  pageSize: number;
  status?: UserStatus;
  veterinarianStatus?: VeterinarianStatus;
  search?: string;
  /** Narrow to users holding this global role key (e.g. `'PET_OWNER'`, `'VETERINARIAN'`). */
  role?: string;
}

/** Raw `users` table row (snake_case). */
export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  gender: string | null;
  country: string | null;
  avatar_key: string | null;
  status: string;
  veterinarian_status: string;
  trader_status: string;
  registration_type: string;
  created_at: Date;
  updated_at: Date;
}
