import { describe, expect, it } from 'vitest';
import { NotificationPolicy } from '../../src/modules/notifications/domain/notification.policy.js';
import type { NotificationPolicyDeps } from '../../src/modules/notifications/domain/notification.policy.js';
import type { DomainEvent } from '../../src/shared/events/index.js';

/** Minimal stub deps — only the calls a given event touches are provided. */
function deps(
  over: Partial<Record<keyof NotificationPolicyDeps, unknown>> = {},
): NotificationPolicyDeps {
  const notImpl = new Proxy(
    {},
    { get: () => () => Promise.reject(new Error('unexpected repo call')) },
  );
  return {
    conversations: notImpl,
    consultations: notImpl,
    inquiries: notImpl,
    memberships: notImpl,
    organizations: notImpl,
    supervisors: notImpl,
    recipients: notImpl,
    ...over,
  } as NotificationPolicyDeps;
}

function ev(name: string, payload: Record<string, unknown>): DomainEvent {
  return { name, payload, occurredAt: new Date() };
}

describe('NotificationPolicy — pure branches', () => {
  it('an unsupported event produces no notifications', async () => {
    const p = new NotificationPolicy(deps());
    expect(await p.resolve(ev('something.unhandled', {}))).toEqual([]);
    expect(await p.resolve(ev('ai.settings.updated', { key: 'X', enabled: true }))).toEqual([]);
  });

  it('content.published does NOT broadcast (no spec requires it)', async () => {
    const p = new NotificationPolicy(deps());
    expect(
      await p.resolve(ev('content.published', { contentId: 'c1', status: 'PUBLISHED' })),
    ).toEqual([]);
  });

  it('organization.approved → the owner, with an idempotency key', async () => {
    const p = new NotificationPolicy(deps());
    const specs = await p.resolve(
      ev('organization.approved', { organizationId: 'o1', ownerUserId: 'u1' }),
    );
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      recipientUserId: 'u1',
      type: 'ORGANIZATION_APPROVED',
      push: true,
      entityType: 'ORGANIZATION',
      entityId: 'o1',
      sourceEventKey: 'organization.approved:o1',
    });
    expect(specs[0]?.data).toMatchObject({ type: 'ORGANIZATION_APPROVED', organizationId: 'o1' });
  });

  it('organization.member.removed with reason "left" → nothing (self-initiated)', async () => {
    const p = new NotificationPolicy(deps());
    expect(
      await p.resolve(
        ev('organization.member.removed', { organizationId: 'o1', userId: 'u1', reason: 'left' }),
      ),
    ).toEqual([]);
  });

  it('supervisor.assigned → the assigned user', async () => {
    const p = new NotificationPolicy(deps());
    const specs = await p.resolve(
      ev('supervisor.assigned', { userId: 'u9', domain: 'CONTENT', assignmentId: 'a1' }),
    );
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      recipientUserId: 'u9',
      type: 'SYSTEM_SUPERVISOR_ASSIGNED',
      sourceEventKey: 'supervisor.assigned:a1',
    });
    expect(specs[0]?.data).toMatchObject({ domain: 'CONTENT' });
  });

  it('consultation.message.created from a responder → notifies the creator (never the sender)', async () => {
    const p = new NotificationPolicy(
      deps({
        consultations: {
          findById: () => Promise.resolve({ id: 't1', createdByUserId: 'creator' }),
        },
      }),
    );
    const specs = await p.resolve(
      ev('consultation.message.created', {
        consultationId: 't1',
        messageId: 'm1',
        source: 'SUPERVISOR',
      }),
    );
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      recipientUserId: 'creator',
      type: 'CONSULTATION_MESSAGE_RECEIVED',
      sourceEventKey: 'consultation.message.created:m1',
    });
  });

  it('consultation.message.created from the creator → notifies active CONSULTATION supervisors, minus the creator', async () => {
    const p = new NotificationPolicy(
      deps({
        consultations: {
          findById: () => Promise.resolve({ id: 't1', createdByUserId: 'creator' }),
        },
        supervisors: {
          list: () =>
            Promise.resolve({
              items: [{ userId: 'sup1' }, { userId: 'creator' }, { userId: 'sup2' }],
              total: 3,
            }),
        },
      }),
    );
    const specs = await p.resolve(
      ev('consultation.message.created', { consultationId: 't1', messageId: 'm2', source: 'USER' }),
    );
    expect(specs.map((s) => s.recipientUserId).sort()).toEqual(['sup1', 'sup2']);
  });

  it('chat.message.created (farm) → the other participant only, never the sender', async () => {
    const p = new NotificationPolicy(
      deps({
        conversations: {
          findById: () =>
            Promise.resolve({
              id: 'c1',
              type: 'FARM_OWNER_MEMBER',
              organizationId: 'farm1',
              memberUserId: 'member',
              petOwnerUserId: null,
            }),
        },
        organizations: { findById: () => Promise.resolve({ id: 'farm1', ownerUserId: 'owner' }) },
      }),
    );
    const fromOwner = await p.resolve(
      ev('chat.message.created', { conversationId: 'c1', messageId: 'm1', senderUserId: 'owner' }),
    );
    expect(fromOwner.map((s) => s.recipientUserId)).toEqual(['member']);
    const fromMember = await p.resolve(
      ev('chat.message.created', { conversationId: 'c1', messageId: 'm2', senderUserId: 'member' }),
    );
    expect(fromMember.map((s) => s.recipientUserId)).toEqual(['owner']);
  });
});

describe('NotificationPolicy — post-Phase-15 mappings', () => {
  const admins = {
    activeAdminUserIds: () => Promise.resolve(['admin1', 'admin2']),
    courseRegistrantUserIds: () => Promise.resolve(['r1', 'r2', 'canceller']),
  };
  const supervisors = {
    list: () => Promise.resolve({ items: [{ userId: 'sup1' }, { userId: 'admin1' }], total: 2 }),
  };

  it('veterinarian.approved → the applicant, keyed by the application', async () => {
    const p = new NotificationPolicy(deps());
    const specs = await p.resolve(
      ev('veterinarian.approved', { userId: 'v1', applicationId: 'app1' }),
    );
    expect(specs).toEqual([
      expect.objectContaining({
        recipientUserId: 'v1',
        type: 'VETERINARIAN_APPROVED',
        entityType: 'VETERINARIAN_APPLICATION',
        entityId: 'app1',
        sourceEventKey: 'veterinarian.approved:app1',
        push: true,
      }),
    ]);
  });

  it('review queues → ADMINs ∪ domain supervisors, de-duplicated, minus the submitter', async () => {
    const p = new NotificationPolicy(deps({ recipients: admins, supervisors }));
    const specs = await p.resolve(
      ev('trader.application.submitted', { userId: 'admin2', traderProfileId: 'tp1' }),
    );
    expect(specs.map((s) => s.recipientUserId).sort()).toEqual(['admin1', 'sup1']);
    expect(specs.every((s) => s.type === 'TRADER_APPLICATION_SUBMITTED')).toBe(true);
  });

  it('user.status.changed: admin transition → ACCOUNT_STATUS_CHANGED; email verification / no-op → nothing', async () => {
    const p = new NotificationPolicy(deps());
    const verified = await p.resolve(
      ev('user.status.changed', {
        userId: 'u1',
        status: 'ACTIVE',
        from: 'PENDING_VERIFICATION',
        reason: 'email_verified',
      }),
    );
    expect(verified).toEqual([]);
    expect(
      await p.resolve(
        ev('user.status.changed', { userId: 'u1', status: 'ACTIVE', from: 'ACTIVE' }),
      ),
    ).toEqual([]);
    const suspended = await p.resolve(
      ev('user.status.changed', { userId: 'u1', status: 'SUSPENDED', from: 'ACTIVE' }),
    );
    expect(suspended[0]).toMatchObject({
      type: 'ACCOUNT_STATUS_CHANGED',
      data: { status: 'SUSPENDED' },
    });
  });

  it('repeatable transitions get a per-occurrence key; a redelivered event keeps it', async () => {
    const p = new NotificationPolicy(deps());
    const first = ev('trader.suspended', { userId: 't1' });
    const later = {
      ...ev('trader.suspended', { userId: 't1' }),
      occurredAt: new Date(Date.now() + 5000),
    };
    const [a] = await p.resolve(first);
    const [aAgain] = await p.resolve(first);
    const [b] = await p.resolve(later);
    expect(a?.sourceEventKey).toBe(aAgain?.sourceEventKey);
    expect(a?.sourceEventKey).not.toBe(b?.sourceEventKey);
  });

  it('store order status → the customer, one key per status', async () => {
    const p = new NotificationPolicy(deps());
    const [spec] = await p.resolve(
      ev('pet_store.order.status_changed', { orderId: 'o1', userId: 'c1', status: 'SHIPPED' }),
    );
    expect(spec).toMatchObject({
      recipientUserId: 'c1',
      type: 'STORE_ORDER_STATUS_CHANGED',
      data: { orderId: 'o1', store: 'PET_OWNER_STORE', status: 'SHIPPED' },
      sourceEventKey: 'pet_store.order.status_changed:o1:SHIPPED',
    });
  });

  it('course registration filling the last seat → organizer gets CAPACITY_REACHED (stable once-only key)', async () => {
    const p = new NotificationPolicy(deps());
    const specs = await p.resolve(
      ev('vet_course.registration.created', {
        registrationId: 'reg2',
        courseId: 'c1',
        creatorUserId: 'org',
        registrantUserId: 'r2',
        capacity: 2,
        registrationCount: 2,
      }),
    );
    expect(specs.map((s) => [s.recipientUserId, s.type])).toEqual([
      ['r2', 'VET_COURSE_REGISTRATION_CONFIRMED'],
      ['org', 'VET_COURSE_REGISTRATION_RECEIVED'],
      ['org', 'VET_COURSE_CAPACITY_REACHED'],
    ]);
    expect(specs[2]?.sourceEventKey).toBe('vet_course.capacity_reached:c1');
  });

  it('course cancelled → registrants minus whoever cancelled', async () => {
    const p = new NotificationPolicy(deps({ recipients: admins }));
    const specs = await p.resolve(
      ev('vet_course.cancelled', {
        courseId: 'c1',
        creatorUserId: 'org',
        actorUserId: 'canceller',
      }),
    );
    expect(specs.map((s) => s.recipientUserId)).toEqual(['r1', 'r2']);
  });

  it('publication moderation by the creator themself produces nothing', async () => {
    const p = new NotificationPolicy(deps());
    expect(
      await p.resolve(
        ev('animal.lost.approved', {
          publicationId: 'p1',
          kind: 'LOST',
          createdByUserId: 'u1',
          actorUserId: 'u1',
        }),
      ),
    ).toEqual([]);
  });

  it('every data value is a string (FCM data payload requirement)', async () => {
    const p = new NotificationPolicy(deps({ recipients: admins, supervisors }));
    const specs = [
      ...(await p.resolve(ev('veterinarian.rejected', { userId: 'v1', applicationId: 'a' }))),
      ...(await p.resolve(ev('pet_store.order.placed', { orderId: 'o1', userId: 'c1' }))),
      ...(await p.resolve(
        ev('vet_course.registration.created', {
          registrationId: 'r',
          courseId: 'c',
          creatorUserId: 'o',
          registrantUserId: 'x',
          capacity: 1,
          registrationCount: 1,
        }),
      )),
    ];
    for (const s of specs) {
      for (const v of Object.values(s.data)) expect(typeof v).toBe('string');
    }
  });
});
