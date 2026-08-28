import { parseRoom } from '../../../infra/realtime/index.js';
import type { RealtimeAuthorizer, RealtimePrincipal } from '../../../infra/realtime/index.js';
import type { ChatService } from '../application/chat.service.js';

/**
 * Realtime subscription authorizer for `conversation:<id>` rooms. Delegates to
 * the SAME {@link ChatService} relationship check used by the HTTP layer, so a
 * socket can never join a conversation room the caller could not `GET`.
 *
 * Registered on {@link CompositeRealtimeAuthorizer} for the `conversation`
 * kind; `user:<id>` rooms keep the default self-room rule.
 */
export class ChatRealtimeAuthorizer implements RealtimeAuthorizer {
  constructor(private readonly chat: ChatService) {}

  async canSubscribe(principal: RealtimePrincipal, room: string): Promise<boolean> {
    if (!principal.userId) return false;
    const parsed = parseRoom(room);
    if (!parsed || parsed.kind !== 'conversation') return false;
    return this.chat.canAccessConversationId(principal.userId, parsed.id);
  }
}
