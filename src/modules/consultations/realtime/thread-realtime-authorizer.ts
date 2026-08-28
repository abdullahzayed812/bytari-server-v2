import { parseRoom } from '../../../infra/realtime/index.js';
import type { RealtimeAuthorizer, RealtimePrincipal } from '../../../infra/realtime/index.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import type { SupportThreadService } from '../application/support-thread.service.js';

/**
 * Realtime subscription authorizer for `consultation:<id>` / `inquiry:<id>`
 * rooms. Delegates to the SAME {@link SupportThreadService} relationship check
 * used by the HTTP layer — a socket can never join a room the caller could not
 * `GET`.
 */
export class ThreadRealtimeAuthorizer implements RealtimeAuthorizer {
  constructor(
    private readonly roomKind: 'consultation' | 'inquiry',
    private readonly service: SupportThreadService,
    private readonly buildPrincipal: (userId: string) => Promise<AuthPrincipal | null>,
  ) {}

  async canSubscribe(principal: RealtimePrincipal, room: string): Promise<boolean> {
    if (!principal.userId) return false;
    const parsed = parseRoom(room);
    if (!parsed || parsed.kind !== this.roomKind) return false;

    const authPrincipal = await this.buildPrincipal(principal.userId);
    if (!authPrincipal) return false;
    return this.service.canAccess(authPrincipal, parsed.id);
  }
}
