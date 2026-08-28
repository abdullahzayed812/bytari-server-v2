import {
  rooms,
  type CompositeRealtimeAuthorizer,
  type RealtimeEventBridge,
} from '../../../infra/realtime/index.js';
import type { Container } from '../../../container.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import { ThreadRealtimeAuthorizer } from './thread-realtime-authorizer.js';

export interface SupportRealtimeWiring {
  /** Register `consultation:` / `inquiry:` room authorizers on the shared composite. */
  registerAuthorizers(composite: CompositeRealtimeAuthorizer): void;
  /** Register `*.message.created` / `*.closed` → WebSocket routes on the bridge. */
  registerBridgeRoutes(bridge: RealtimeEventBridge): void;
}

interface MessagePayload {
  consultationId?: string;
  inquiryId?: string;
  messageId: string;
  source: string;
}
interface ThreadIdPayload {
  consultationId?: string;
  inquiryId?: string;
}
interface CreatedPayload {
  consultationId?: string;
  inquiryId?: string;
  createdByUserId: string;
}

/**
 * Phase 13 realtime, layered on the Phase-12 seam:
 *  - reuses the shared JWT authenticator + `CompositeRealtimeAuthorizer`,
 *  - authorizes `consultation:<id>` / `inquiry:<id>` subscriptions with the
 *    SAME `SupportThreadService` relationship check as REST,
 *  - fans `*.message.created` / `*.closed` / `*.sender_blocked*` to the thread
 *    room and `*.created` to the creator's user room (ids-only payloads).
 */
export function createSupportRealtime(container: Container): SupportRealtimeWiring {
  const buildPrincipal = async (userId: string): Promise<AuthPrincipal | null> => {
    const user = await container.userService.getByIdOrNull(userId);
    if (!user || user.status !== 'ACTIVE') return null;
    return {
      userId: user.id,
      email: user.email,
      status: user.status,
      veterinarianStatus: user.veterinarianStatus,
      roleKeys: await container.roleRepository.getRoleKeysForUser(user.id),
      sessionId: null,
    };
  };

  return {
    registerAuthorizers(composite): void {
      composite.register(
        'consultation',
        new ThreadRealtimeAuthorizer('consultation', container.consultationService, buildPrincipal),
      );
      composite.register(
        'inquiry',
        new ThreadRealtimeAuthorizer('inquiry', container.inquiryService, buildPrincipal),
      );
    },

    registerBridgeRoutes(bridge): void {
      const roomFor = (p: { consultationId?: string; inquiryId?: string }): string | null => {
        if (p.consultationId) return rooms.consultation(p.consultationId);
        if (p.inquiryId) return rooms.inquiry(p.inquiryId);
        return null;
      };

      for (const name of ['consultation.message.created', 'inquiry.message.created']) {
        bridge.route<MessagePayload>(name, (event) => {
          const room = roomFor(event.payload);
          return room ? { toRoom: room, event: { type: name, data: event.payload } } : null;
        });
      }
      for (const name of [
        'consultation.closed',
        'inquiry.closed',
        'consultation.sender_blocked',
        'inquiry.sender_blocked',
        'consultation.sender_unblocked',
        'inquiry.sender_unblocked',
      ]) {
        bridge.route<ThreadIdPayload>(name, (event) => {
          const room = roomFor(event.payload);
          return room ? { toRoom: room, event: { type: name, data: event.payload } } : null;
        });
      }
      for (const name of ['consultation.created', 'inquiry.created']) {
        bridge.route<CreatedPayload>(name, (event) => ({
          toUserId: event.payload.createdByUserId,
          event: {
            type: name,
            data: {
              ...(event.payload.consultationId
                ? { consultationId: event.payload.consultationId }
                : {}),
              ...(event.payload.inquiryId ? { inquiryId: event.payload.inquiryId } : {}),
            },
          },
        }));
      }
    },
  };
}
