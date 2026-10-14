/**
 * In-process domain event bus.
 *
 * Business modules publish typed domain events here; infrastructure adapters
 * (real-time gateway, push notifications, in-app notifications, audit log, …)
 * subscribe. This keeps modules decoupled from delivery mechanisms — a module
 * never imports the WebSocket gateway or the Firebase provider directly.
 *
 * Semantics:
 *  - `publish` is fire-and-forget and never throws to the caller.
 *  - handler errors are caught and logged, never propagated.
 *  - delivery is asynchronous (next microtask). That does NOT wait for a DB
 *    commit — a microtask runs before an awaited COMMIT completes — so
 *    publishers MUST call `publish` after `db.transaction(...)` resolves,
 *    never inside the callback (every current publisher does).
 *
 * A cross-process implementation (Redis / NATS) can replace this behind the
 * same interface when the deployment scales beyond one node.
 */

export interface DomainEvent<T = unknown> {
  /** Dotted event name, e.g. `chat.message.created`. */
  name: string;
  payload: T;
  occurredAt: Date;
  /** Optional correlation id (e.g. the originating HTTP request id). */
  correlationId?: string;
}

export type EventHandler<T = unknown> = (event: DomainEvent<T>) => void | Promise<void>;

/**
 * Wildcard subscription key: pass this as the event name to receive every
 * published event.
 */
export const ALL_EVENTS = '*';

export interface EventBus {
  publish<T>(name: string, payload: T, meta?: { correlationId?: string }): void;
  /**
   * Subscribe to one event name, or {@link ALL_EVENTS} for all of them.
   * Returns an unsubscribe function.
   */
  subscribe<T = unknown>(name: string, handler: EventHandler<T>): () => void;
}
