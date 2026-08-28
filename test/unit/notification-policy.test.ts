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
