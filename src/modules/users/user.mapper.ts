import type { PublicUser, User, UserRow, UserStatus, VeterinarianStatus } from './user.types.js';

export function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    status: row.status as UserStatus,
    veterinarianStatus: row.veterinarian_status as VeterinarianStatus,
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
    status: user.status,
    veterinarianStatus: user.veterinarianStatus,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
