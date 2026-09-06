import type {
  Gender,
  PublicUser,
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
    avatarKey: row.avatar_key,
    status: row.status as UserStatus,
    veterinarianStatus: row.veterinarian_status as VeterinarianStatus,
    traderStatus: row.trader_status as TraderStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Strip the password hash and normalise dates for API responses. */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    gender: user.gender,
    country: user.country,
    avatarKey: user.avatarKey,
    status: user.status,
    veterinarianStatus: user.veterinarianStatus,
    traderStatus: user.traderStatus,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/** Name-only directory projection. See {@link UserSummary}. */
export function toUserSummary(user: User): UserSummary {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    veterinarianStatus: user.veterinarianStatus,
    traderStatus: user.traderStatus,
  };
}
