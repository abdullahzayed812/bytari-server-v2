export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const VETERINARIAN_STATUSES = ['NOT_APPLIED', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type VeterinarianStatus = (typeof VETERINARIAN_STATUSES)[number];

/** Full user aggregate, including the password hash. Never leaves the service layer. */
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone: string | null;
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
  status: UserStatus;
  veterinarianStatus: VeterinarianStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserData {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
}

export interface UpdateUserData {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
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
  status: string;
  veterinarian_status: string;
  created_at: Date;
  updated_at: Date;
}
