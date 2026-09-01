import type { PublicUser } from '../users/user.types.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Access-token lifetime in seconds. */
  expiresIn: number;
}

export interface AuthResult {
  user: PublicUser;
  tokens: AuthTokens;
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  gender?: 'MALE' | 'FEMALE' | null;
  country?: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
}
