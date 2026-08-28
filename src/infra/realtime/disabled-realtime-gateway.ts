import type { Server as HttpServer } from 'node:http';
import type { RealtimeEvent, RealtimeGateway } from './types.js';

/**
 * No-op gateway used when `REALTIME_ENABLED=false`. Every publish call is safely
 * ignored so business modules need no conditional logic.
 */
export class DisabledRealtimeGateway implements RealtimeGateway {
  isEnabled(): boolean {
    return false;
  }

  connectionCount(): number {
    return 0;
  }

  attach(_server: HttpServer): void {
    /* no-op */
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  emitToUser(_userId: string, _event: RealtimeEvent): void {
    /* no-op */
  }

  emitToRoom(_room: string, _event: RealtimeEvent): void {
    /* no-op */
  }

  broadcast(_event: RealtimeEvent): void {
    /* no-op */
  }
}
