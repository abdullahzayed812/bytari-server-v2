import { rooms, type RealtimeEventBridge } from '../../../infra/realtime/index.js';

export interface NotificationRealtimeWiring {
  registerBridgeRoutes(bridge: RealtimeEventBridge): void;
}

interface CreatedPayload {
  notificationId: string;
  recipientUserId: string;
  type: string;
}
interface ReadPayload {
  notificationId?: string;
  recipientUserId: string;
  all?: boolean;
}

/**
 * Delivers `notification.created` / `notification.read` to the recipient's own
 * `user:<id>` room. No new authorizer — that room is already self-only
 * (`SelfRoomAuthorizer`), so a user can never subscribe to another user's
 * notification stream. Realtime is a best-effort extra channel; the in-app row
 * is the source of truth.
 */
export function createNotificationRealtime(): NotificationRealtimeWiring {
  return {
    registerBridgeRoutes(bridge): void {
      bridge.route<CreatedPayload>('notification.created', (event) => ({
        toUserId: event.payload.recipientUserId,
        event: {
          type: 'notification.created',
          data: { notificationId: event.payload.notificationId, type: event.payload.type },
        },
      }));
      bridge.route<ReadPayload>('notification.read', (event) => ({
        toUserId: event.payload.recipientUserId,
        event: {
          type: 'notification.read',
          data: event.payload.all
            ? { all: true }
            : { notificationId: event.payload.notificationId },
        },
      }));
    },
  };
}

export { rooms };
