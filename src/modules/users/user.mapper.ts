import type {
  Gender,
  PublicUser,
  RegistrationType,
  TraderStatus,
  User,
  UserRow,
  UserStatus,
  UserSummary,
  VeterinarianStatus,
} from './user.types.js';

export function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    gender: (row.gender as Gender | null) ?? null,
    country: row.country,
    governorate: row.governorate ?? null,
    specialization: row.specialization ?? null,
    avatarKey: row.avatar_key,
    status: row.status as UserStatus,
    veterinarianStatus: row.veterinarian_status as VeterinarianStatus,
    traderStatus: row.trader_status as TraderStatus,
    registrationType: row.registration_type as RegistrationType,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Strip the password hash and normalise dates for API responses.
 *
 * `avatarUrl` must be resolved from `user.avatarKey` by a caller that holds
 * {@link ObjectStorage} — use `UserService.toPublicUserWithAvatar` rather than
 * this mapper wherever the response is meant to render the avatar.
 */
export function toPublicUser(user: User, avatarUrl: string | null = null): PublicUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    gender: user.gender,
    country: user.country,
    governorate: user.governorate,
    specialization: user.specialization,
    avatarUrl,
    status: user.status,
    veterinarianStatus: user.veterinarianStatus,
    traderStatus: user.traderStatus,
    registrationType: user.registrationType,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/** Name-only directory projection. See {@link UserSummary}. */
export function toUserSummary(user: User, avatarUrl: string | null = null): UserSummary {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    veterinarianStatus: user.veterinarianStatus,
    traderStatus: user.traderStatus,
    specialization: user.specialization,
    avatarUrl,
  };
}
