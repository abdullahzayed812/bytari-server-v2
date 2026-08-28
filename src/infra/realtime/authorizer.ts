import { parseRoom, rooms } from './rooms.js';
import type { RealtimeAuthorizer, RealtimePrincipal } from './types.js';

/**
 * Conservative default authorizer: a socket may only subscribe to its own
 * `user:{id}` room. Every other room (org / conversation / consultation / …)
 * is denied until a module supplies a policy that checks membership.
 *
 * Phase 2+ replaces this with a composite authorizer that consults the
 * organisation-membership and thread-participant tables — the SAME source of
 * truth the REST authorization layer uses.
 */
export class SelfRoomAuthorizer implements RealtimeAuthorizer {
  canSubscribe(principal: RealtimePrincipal, room: string): Promise<boolean> {
    if (principal.userId && room === rooms.user(principal.userId)) {
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }
}

/**
 * Compose several authorizers by room kind. Unmatched kinds fall through to
 * `fallback` (defaults to {@link SelfRoomAuthorizer}). Lets each module register
 * a rule for its own room namespace without a central switch statement.
 */
export class CompositeRealtimeAuthorizer implements RealtimeAuthorizer {
  private readonly byKind = new Map<string, RealtimeAuthorizer>();

  constructor(private readonly fallback: RealtimeAuthorizer = new SelfRoomAuthorizer()) {}

  register(kind: string, authorizer: RealtimeAuthorizer): this {
    this.byKind.set(kind, authorizer);
    return this;
  }

  canSubscribe(principal: RealtimePrincipal, room: string): Promise<boolean> {
    const parsed = parseRoom(room);
    const delegate = (parsed && this.byKind.get(parsed.kind)) || this.fallback;
    return delegate.canSubscribe(principal, room);
  }
}
