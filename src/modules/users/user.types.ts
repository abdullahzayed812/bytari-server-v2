export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const VETERINARIAN_STATUSES = ['NOT_APPLIED', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type VeterinarianStatus = (typeof VETERINARIAN_STATUSES)[number];

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
  avatarKey: string | null;
  status: UserStatus;
  veterinarianStatus: VeterinarianStatus;
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
}

export interface CreateUserData {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  gender?: Gender | null;
  country?: string | null;
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
  passwordHash?: string;
}

export interface ListUsersFilter {
  page: number;
  pageSize: number;
  status?: UserStatus;
  veterinarianStatus?: VeterinarianStatus;
  search?: string;
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
  created_at: Date;
  updated_at: Date;
}
