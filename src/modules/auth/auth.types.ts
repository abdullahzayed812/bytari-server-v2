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

/**
 * `POST /auth/register` response. Carries a real session (`AuthResult`'s
 * shape) — see `AuthService.register`'s doc comment for why — PLUS
 * `codeExpiresInSeconds` so the client can drive the verify-screen countdown
 * without hardcoding the server's TTL.
 */
export interface RegisterResult extends AuthResult {
  codeExpiresInSeconds: number;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface VerifyEmailInput {
  email: string;
  code: string;
}

export interface ResendVerificationResult {
  codeExpiresInSeconds: number;
  resendAvailableInSeconds: number;
}
