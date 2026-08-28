import {
  parseRoom,
  rooms,
  type CompositeRealtimeAuthorizer,
  type RealtimeAuthorizer,
  type RealtimeEventBridge,
  type RealtimePrincipal,
} from '../../../infra/realtime/index.js';
import type { Container } from '../../../container.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import type { RoleRepository } from '../../rbac/role.repository.js';
import type { UserService } from '../../users/user.service.js';

/**
 * `content:feed` — a single activity room for Admin / Content Supervisor
 * clients. A socket may subscribe only if it currently holds `content.read`
 * AND (ADMIN or approved veterinarian) — the same gate as the HTTP admin
 * routes. Normal users never get content realtime.
 */
class ContentFeedAuthorizer implements RealtimeAuthorizer {
  constructor(
    private readonly authz: AuthorizationService,
    private readonly users: UserService,
    private readonly roles: RoleRepository,
  ) {}

  private async principal(userId: string): Promise<AuthPrincipal | null> {
    const user = await this.users.getByIdOrNull(userId);
    if (!user || user.status !== 'ACTIVE') return null;
    return {
      userId: user.id,
      email: user.email,
      status: user.status,
      veterinarianStatus: user.veterinarianStatus,
      roleKeys: await this.roles.getRoleKeysForUser(user.id),
      sessionId: null,
    };
  }

  async canSubscribe(principal: RealtimePrincipal, room: string): Promise<boolean> {
    if (!principal.userId) return false;
    const parsed = parseRoom(room);
    if (!parsed || parsed.kind !== 'content' || parsed.id !== 'feed') return false;

    const p = await this.principal(principal.userId);
    if (!p) return false;
    if (!(await this.authz.can(p, 'content.read'))) return false;
    return this.authz.isAdmin(p) || this.authz.isApprovedVeterinarian(p);
  }
}

export interface ContentRealtimeWiring {
  registerAuthorizers(composite: CompositeRealtimeAuthorizer): void;
  registerBridgeRoutes(bridge: RealtimeEventBridge): void;
}

const FEED_EVENTS = [
  'content.created',
  'content.updated',
  'content.published',
  'content.archived',
  'content.deleted',
  'content.restored',
  'content.file.uploaded',
  'content.file.replaced',
  'content.file.deleted',
  'content.category.created',
  'content.category.updated',
  'content.category.deleted',
] as const;

export function createContentRealtime(container: Container): ContentRealtimeWiring {
  return {
    registerAuthorizers(composite): void {
      composite.register(
        'content',
        new ContentFeedAuthorizer(
          container.authorizationService,
          container.userService,
          container.roleRepository,
        ),
      );
    },
    registerBridgeRoutes(bridge): void {
      for (const name of FEED_EVENTS) {
        bridge.route(name, (event) => ({
          toRoom: rooms.contentFeed(),
          event: { type: name, data: event.payload },
        }));
      }
    },
  };
}
