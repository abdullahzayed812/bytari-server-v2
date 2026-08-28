import {
  CompositeRealtimeAuthorizer,
  rooms,
  type ConnectionAuthenticator,
  type RealtimeEventBridge,
} from '../../../infra/realtime/index.js';
import type { Container } from '../../../container.js';
import { ChatRealtimeAuthorizer } from './chat-realtime-authorizer.js';
import { JwtConnectionAuthenticator } from './jwt-connection-authenticator.js';

export interface ChatRealtimeWiring {
  authenticator: ConnectionAuthenticator;
  /**
   * The process-wide composite authorizer. Other modules (Phase 13+) register
   * their own room kinds on it before it is handed to `createInfrastructure`.
   */
  authorizer: CompositeRealtimeAuthorizer;
  /** Register the domain-event → WebSocket routes on the infra bridge. */
  registerBridgeRoutes(bridge: RealtimeEventBridge): void;
}

interface ConversationCreatedPayload {
  conversationId: string;
  participantUserIds: string[];
}
interface MessageEventPayload {
  conversationId: string;
  messageId: string;
  senderUserId?: string;
}

/**
 * Build the chat realtime layer from the service container:
 *  - a JWT connection authenticator (reuses REST token verification),
 *  - a composite authorizer that gates `conversation:<id>` subscriptions with
 *    the ChatService relationship check (`user:<id>` keeps the self-room rule),
 *  - bridge routes that push `chat.message.*` to the conversation room and
 *    `chat.conversation.created` to each participant's user room.
 *
 * Payloads are ids-only.
 */
export function createChatRealtime(container: Container): ChatRealtimeWiring {
  const authenticator = new JwtConnectionAuthenticator({
    tokens: container.tokenService,
    users: container.userService,
    roles: container.roleRepository,
    logger: container.logger,
  });

  const authorizer = new CompositeRealtimeAuthorizer().register(
    'conversation',
    new ChatRealtimeAuthorizer(container.chatService),
  );

  return {
    authenticator,
    authorizer,
    registerBridgeRoutes(bridge: RealtimeEventBridge): void {
      bridge.route<MessageEventPayload>('chat.message.created', (event) => ({
        toRoom: rooms.conversation(event.payload.conversationId),
        event: { type: 'chat.message.created', data: event.payload },
      }));
      bridge.route<MessageEventPayload>('chat.message.deleted', (event) => ({
        toRoom: rooms.conversation(event.payload.conversationId),
        event: { type: 'chat.message.deleted', data: event.payload },
      }));
      bridge.route<ConversationCreatedPayload>('chat.conversation.created', (event) =>
        event.payload.participantUserIds.map((userId) => ({
          toUserId: userId,
          event: {
            type: 'chat.conversation.created',
            data: { conversationId: event.payload.conversationId },
          },
        })),
      );
    },
  };
}
