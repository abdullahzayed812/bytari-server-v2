import type { Knex } from 'knex';
import type { NotificationType } from '../domain/notification.constants.js';
import type { Notification, NotificationSource } from '../domain/notification.types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Global roles whose actions are presented to recipients as "the administration". */
const STAFF_ROLE_KEYS = ['ADMIN', 'MODERATOR'] as const;
/**
 * Types whose sender IS the organization (its own announcement / message /
 * reply), so the organization's name wins even when the posting officer is
 * also platform staff. For every other type a staff actor wins — e.g.
 * "your clinic was approved" is from the administration, not the clinic.
 */
const ORGANIZATION_SENDER_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'ORGANIZATION_BROADCAST',
  'SYNDICATE_ANNOUNCEMENT_PUBLISHED',
  'SYNDICATE_SUBMISSION_RESPONDED',
]);

/**
 * Platform moderation decisions (approve / reject / suspend …). They are taken
 * by the administration (admins or system supervisors) even when the domain
 * event carries no actor, so they always read "From: the administration".
 */
const ADMIN_DECISION_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  'ACCOUNT_STATUS_CHANGED',
  'VETERINARIAN_APPROVED',
  'VETERINARIAN_REJECTED',
  'ORGANIZATION_APPROVED',
  'ORGANIZATION_REJECTED',
  'ORGANIZATION_SUSPENDED',
  'ORGANIZATION_ACTIVATED',
  'ORGANIZATION_DEACTIVATED',
  'SUBSCRIPTION_UPDATED',
  'SUBSCRIPTION_RENEWAL_APPROVED',
  'SUBSCRIPTION_RENEWAL_REJECTED',
  'TRADER_APPROVED',
  'TRADER_REJECTED',
  'TRADER_SUSPENDED',
  'TRADER_REACTIVATED',
  'SYSTEM_SUPERVISOR_ASSIGNED',
  'VET_SERVICE_LISTING_APPROVED',
  'VET_SERVICE_LISTING_REJECTED',
  'VET_SERVICE_REQUEST_APPROVED',
  'VET_SERVICE_REQUEST_REJECTED',
  'VET_COURSE_APPROVED',
  'VET_COURSE_REJECTED',
  'VET_JOB_OFFER_APPROVED',
  'VET_JOB_OFFER_REJECTED',
  'VET_JOB_SEEKER_PROFILE_APPROVED',
  'VET_JOB_SEEKER_PROFILE_REJECTED',
  'PUBLICATION_APPROVED',
  'PUBLICATION_REJECTED',
]);

function organizationIdOf(n: Notification): string | null {
  const fromData = n.data?.organizationId;
  if (typeof fromData === 'string' && UUID_RE.test(fromData)) return fromData;
  if (n.entityType === 'ORGANIZATION' && n.entityId && UUID_RE.test(n.entityId)) {
    return n.entityId;
  }
  return null;
}

/**
 * Read-side "who is this from?" for the notification inbox, derived from data
 * every row already carries (no migration — older rows resolve too):
 *
 * 1. `ADMIN_ANNOUNCEMENT`, or an admin broadcast row (`data.source = 'ADMIN'`)
 *    → the administration.
 * 2. An organization-authored type (`ORGANIZATION_SENDER_TYPES`, e.g. a
 *    syndicate announcement) → that organization, by its own name.
 * 3. A platform moderation decision (`ADMIN_DECISION_TYPES`, e.g. "your
 *    clinic was approved"), or an actor other than the recipient who is
 *    platform staff (ADMIN / MODERATOR role or an active system supervisor —
 *    e.g. a support reply) → the administration.
 * 4. Any other organization context (`data.organizationId`, or an
 *    ORGANIZATION entity) the recipient does NOT belong to → that
 *    organization (e.g. a clinic confirming a pet owner's appointment). When
 *    the recipient is the org's owner / member it is their own side (e.g. a
 *    pet owner's message to their clinic), so the actor is the sender.
 * 5. Any other actor → that user's display name.
 * 6. Otherwise a platform-generated (system) notification.
 *
 * Only display names are exposed (never email / phone), and only for actors
 * already tied to the recipient's own notification. Lookups are batched per page.
 */
export class NotificationSourceResolver {
  constructor(private readonly db: Knex) {}

  async resolve(items: Notification[]): Promise<Map<string, NotificationSource>> {
    const result = new Map<string, NotificationSource>();
    if (items.length === 0) return result;

    const orgIds = new Set<string>();
    const actorIds = new Set<string>();
    for (const n of items) {
      if (isAdminRow(n)) continue;
      const orgId = organizationIdOf(n);
      if (orgId) orgIds.add(orgId);
      if (n.actorUserId && n.actorUserId !== n.recipientUserId) actorIds.add(n.actorUserId);
    }

    const recipientIds = [...new Set(items.map((n) => n.recipientUserId))];
    const [orgs, memberships, actors, staff] = await Promise.all([
      orgIds.size
        ? this.db('organizations')
            .whereIn('id', [...orgIds])
            .select<Array<{ id: string; name: string; type: string; owner_user_id: string }>>(
              'id',
              'name',
              'type',
              'owner_user_id',
            )
        : Promise.resolve([]),
      orgIds.size
        ? this.db('organization_memberships')
            .whereIn('organization_id', [...orgIds])
            .whereIn('user_id', recipientIds)
            .where('status', 'ACTIVE')
            .select<Array<{ organization_id: string; user_id: string }>>(
              'organization_id',
              'user_id',
            )
        : Promise.resolve([]),
      actorIds.size
        ? this.db('users')
            .whereIn('id', [...actorIds])
            .select<Array<{ id: string; first_name: string; last_name: string }>>(
              'id',
              'first_name',
              'last_name',
            )
        : Promise.resolve([]),
      actorIds.size ? this.staffAmong([...actorIds]) : Promise.resolve(new Set<string>()),
    ]);
    const orgById = new Map(orgs.map((o) => [o.id, o]));
    const insiders = new Set(memberships.map((m) => `${m.organization_id}:${m.user_id}`));
    for (const o of orgs) insiders.add(`${o.id}:${o.owner_user_id}`);
    const actorById = new Map(actors.map((u) => [u.id, u]));

    for (const n of items) {
      result.set(n.id, this.sourceFor(n, orgById, insiders, actorById, staff));
    }
    return result;
  }

  private sourceFor(
    n: Notification,
    orgById: Map<string, { id: string; name: string; type: string }>,
    insiders: Set<string>,
    actorById: Map<string, { id: string; first_name: string; last_name: string }>,
    staff: Set<string>,
  ): NotificationSource {
    if (isAdminRow(n)) return { kind: 'ADMIN' };
    const orgId = organizationIdOf(n);
    const org = orgId ? orgById.get(orgId) : undefined;
    const orgSource: NotificationSource | null = org
      ? { kind: 'ORGANIZATION', organizationId: org.id, organizationType: org.type, name: org.name }
      : null;
    const actorId = n.actorUserId && n.actorUserId !== n.recipientUserId ? n.actorUserId : null;

    if (orgSource && ORGANIZATION_SENDER_TYPES.has(n.type)) return orgSource;
    if (actorId && staff.has(actorId)) return { kind: 'ADMIN' };
    if (orgSource && !insiders.has(`${orgId}:${n.recipientUserId}`)) return orgSource;
    if (actorId) {
      const actor = actorById.get(actorId);
      if (actor) {
        const name = `${actor.first_name} ${actor.last_name}`.trim();
        if (name) return { kind: 'USER', userId: actor.id, name };
      }
    }
    return { kind: 'SYSTEM' };
  }

  private async staffAmong(userIds: string[]): Promise<Set<string>> {
    const [roleRows, supervisorRows] = await Promise.all([
      this.db('user_roles as ur')
        .join('roles as r', 'r.id', 'ur.role_id')
        .whereIn('ur.user_id', userIds)
        .whereIn('r.key', STAFF_ROLE_KEYS)
        .select<Array<{ user_id: string }>>('ur.user_id'),
      this.db('system_supervisor_assignments')
        .whereIn('user_id', userIds)
        .where('status', 'ACTIVE')
        .select<Array<{ user_id: string }>>('user_id'),
    ]);
    return new Set([...roleRows, ...supervisorRows].map((r) => r.user_id));
  }
}

function isAdminRow(n: Notification): boolean {
  return (
    n.type === 'ADMIN_ANNOUNCEMENT' ||
    n.data?.source === 'ADMIN' ||
    ADMIN_DECISION_TYPES.has(n.type)
  );
}
