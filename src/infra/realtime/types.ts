import type { Server as HttpServer } from 'node:http';

/**
 * Real-time (WebSocket) infrastructure contracts.
 *
 * Business modules depend ONLY on {@link RealtimePublisher} — the narrow
 * publish surface. Connection handling, authentication and authorization live
 * entirely inside the gateway implementation.
 */

/** Identity attached to an authenticated socket. Mirrors the future HTTP auth principal. */
export interface RealtimePrincipal {
  /** `null` only for explicitly-allowed anonymous connections (dev). */
  userId: string | null;
  /** Global base roles (e.g. `ADMIN`, `VETERINARIAN`). */
  roles: string[];
  isAnonymous: boolean;
  /** Provider-specific extra claims (organisation memberships, etc.). */
  claims?: Record<string, unknown>;
}

/** Raw data available at the WebSocket upgrade, handed to the authenticator. */
export interface RealtimeHandshake {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | undefined>;
  ip: string | undefined;
}

/**
 * Turns a handshake into a {@link RealtimePrincipal}, or throws
 * {@link RealtimeAuthError} to reject the connection.
 *
 * Phase 1 ships deny-all / anonymous implementations; Phase 2 injects a
 * JWT-backed one that reuses the REST token verification.
 */
export interface ConnectionAuthenticator {
  authenticate(handshake: RealtimeHandshake): Promise<RealtimePrincipal>;
}

/**
 * Decides whether an authenticated principal may subscribe to a given room.
 * Enforces the SAME organisation-scoping / relationship rules as the REST API.
 * Server-originated emits (from modules) are NOT gated by this.
 */
export interface RealtimeAuthorizer {
  canSubscribe(principal: RealtimePrincipal, room: string): Promise<boolean>;
}

/** An event pushed to clients. `type` is a dotted name, e.g. `chat.message.created`. */
export interface RealtimeEvent<T = unknown> {
  type: string;
  data: T;
  meta?: Record<string, unknown>;
}

/**
 * The only real-time surface exposed to business modules.
 * Implementations must be safe to call when the gateway is disabled (no-op).
 */
export interface RealtimePublisher {
  emitToUser(userId: string, event: RealtimeEvent): void;
  emitToRoom(room: string, event: RealtimeEvent): void;
  broadcast(event: RealtimeEvent): void;
  isEnabled(): boolean;
  connectionCount(): number;
}

/** Full gateway: publisher + connection lifecycle, owned by the process bootstrap. */
export interface RealtimeGateway extends RealtimePublisher {
  /** Attach to the shared HTTP server and start accepting upgrades. */
  attach(server: HttpServer): void;
  /** Stop the gateway and close all sockets. */
  close(): Promise<void>;
}

export class RealtimeAuthError extends Error {
  constructor(message = 'Realtime authentication failed') {
    super(message);
    this.name = 'RealtimeAuthError';
  }
}
