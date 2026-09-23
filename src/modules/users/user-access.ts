import type { User } from './user.types.js';

/**
 * What an account may do right now — the ONE rule every entry point
 * (`authenticate` middleware, the realtime socket authenticator, `GET
 * /auth/me`) evaluates, so HTTP, sockets and the mobile client never disagree.
 *
 *   FULL                            → normal application access (RBAC still applies)
 *   EMAIL_VERIFICATION_REQUIRED     → Pet Owner signup, emailed code not confirmed yet
 *   VETERINARIAN_APPROVAL_REQUIRED  → Veterinarian signup whose application is not
 *                                     APPROVED (not submitted yet / PENDING / REJECTED)
 *   INACTIVE                        → suspended / deactivated
 *
 * Both onboarding states may only reach the small self-service allowlist
 * (`createAuthenticate({ allowOnboarding: true })`).
 *
 * The veterinarian gate keys off `registrationType`, not `veterinarianStatus`
 * alone: a Pet Owner who applies in-app keeps full Pet Owner access while
 * their application is reviewed.
 */
export type AccessState =
  | 'FULL'
  | 'EMAIL_VERIFICATION_REQUIRED'
  | 'VETERINARIAN_APPROVAL_REQUIRED'
  | 'INACTIVE';

export function accessStateFor(
  user: Pick<User, 'status' | 'registrationType' | 'veterinarianStatus'>,
): AccessState {
  if (user.status === 'PENDING_VERIFICATION') return 'EMAIL_VERIFICATION_REQUIRED';
  if (user.status !== 'ACTIVE') return 'INACTIVE';
  if (user.registrationType === 'VETERINARIAN' && user.veterinarianStatus !== 'APPROVED') {
    return 'VETERINARIAN_APPROVAL_REQUIRED';
  }
  return 'FULL';
}
