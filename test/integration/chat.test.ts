import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { DomainEvent } from '../../src/shared/events/index.js';
import { ALL_EVENTS } from '../../src/shared/events/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createActiveOrganization,
  createFarm,
  deleteChatMessage,
  joinFarm,
  listChatMessages,
  listConversations,
  markConversationRead,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  sendChatMessage,
  startConversation,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();

const captured: string[] = [];
container.eventBus.subscribe(ALL_EVENTS, (e: DomainEvent) => {
  if (e.name.startsWith('chat.')) captured.push(e.name);
});
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  captured.length = 0;
});
afterAll(() => closeTestDb());

async function auditRows(
  entityId: string,
): Promise<
  Array<{ action: string; actor_user_id: string | null; metadata: Record<string, unknown> }>
> {
  return getTestDb()('audit_logs')
    .where({ entity_id: entityId })
    .orderBy('created_at', 'asc')
    .select('action', 'actor_user_id', 'metadata');
}

async function setMembershipStatus(
  userId: string,
  organizationId: string,
  status: string,
): Promise<void> {
  await getTestDb()('organization_memberships')
    .where({ user_id: userId, organization_id: organizationId })
    .update({ status });
}

// --- Clinic chat (Pet Owner ↔ Clinic) -------------------------------

describe('clinic chat — Pet Owner ↔ Clinic', () => {
  async function clinicSetup() {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const clinicVet = await registerApprovedVet(app);
    const staff = await registerUser(app);
    const petOwner = await registerUser(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Cairo Vet Clinic',
    });
    await addOrganizationMember(app, vetOwner.accessToken, clinic.id, {
      userId: clinicVet.id,
      role: 'VETERINARIAN',
    });
    await addOrganizationMember(app, vetOwner.accessToken, clinic.id, {
      userId: staff.id,
      role: 'STAFF',
    });
    return { admin, vetOwner, clinicVet, staff, petOwner, clinic };
  }

  it('a pet owner opens a conversation with the clinic and both sides exchange messages', async () => {
    const { vetOwner, clinicVet, petOwner, clinic } = await clinicSetup();

    const conv = await startConversation(app, petOwner.accessToken, clinic.id);
    expect(conv.type).toBe('PET_OWNER_CLINIC');
    expect(conv.organizationId).toBe(clinic.id);
    expect(conv.counterpartUserId).toBe(petOwner.id);
    expect(conv.viewerSide).toBe('PET_OWNER');

    // idempotent: same pet owner + clinic → same conversation, HTTP 200
    const again = await request(app)
      .post(`/api/v1/organizations/${clinic.id}/conversations`)
      .set(bearer(petOwner.accessToken))
      .send({});
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(conv.id);

    const m1 = await sendChatMessage(
      app,
      petOwner.accessToken,
      conv.id,
      'Hello, my dog is limping',
    );
    expect(m1.status).toBe(201);
    expect(m1.body.data.senderUserId).toBe(petOwner.id);
    expect(m1.body.data.body).toBe('Hello, my dog is limping');

    // any ACTIVE clinic member (owner OR vet) can see and reply — it is the CLINIC's conversation
    const ownerView = await request(app)
      .get(`/api/v1/conversations/${conv.id}`)
      .set(bearer(vetOwner.accessToken));
    expect(ownerView.status).toBe(200);
    expect(ownerView.body.data.viewerSide).toBe('CLINIC');
    expect(ownerView.body.data.unreadCount).toBeNull(); // clinic side has no per-member read state

    const reply = await sendChatMessage(app, clinicVet.accessToken, conv.id, 'Please bring him in');
    expect(reply.status).toBe(201);

    const msgs = await listChatMessages(app, petOwner.accessToken, conv.id);
    expect(msgs.status).toBe(200);
    expect(msgs.body.data).toHaveLength(2);
    // newest first
    expect(msgs.body.data[0].body).toBe('Please bring him in');
    expect(msgs.body.meta.total).toBe(2);
  });

  it('a clinic member can start a conversation on behalf of a named pet owner', async () => {
    const { staff, petOwner, clinic } = await clinicSetup();
    const conv = await startConversation(app, staff.accessToken, clinic.id, petOwner.id);
    expect(conv.type).toBe('PET_OWNER_CLINIC');
    expect(conv.counterpartUserId).toBe(petOwner.id);
    expect(conv.viewerSide).toBe('CLINIC');
  });

  it('a clinic member starting a conversation without a target is 400', async () => {
    const { vetOwner, clinic } = await clinicSetup();
    const res = await request(app)
      .post(`/api/v1/organizations/${clinic.id}/conversations`)
      .set(bearer(vetOwner.accessToken))
      .send({});
    expect(res.status).toBe(400);
  });

  it('a clinic member cannot open a clinic conversation with another clinic member', async () => {
    const { vetOwner, clinicVet, clinic } = await clinicSetup();
    const res = await request(app)
      .post(`/api/v1/organizations/${clinic.id}/conversations`)
      .set(bearer(vetOwner.accessToken))
      .send({ targetUserId: clinicVet.id });
    expect(res.status).toBe(400);
  });

  it('a pet owner cannot open a conversation on behalf of someone else', async () => {
    const { petOwner, staff, clinic } = await clinicSetup();
    const res = await request(app)
      .post(`/api/v1/organizations/${clinic.id}/conversations`)
      .set(bearer(petOwner.accessToken))
      .send({ targetUserId: staff.id });
    expect(res.status).toBe(403);
  });

  it('chat is rejected for a non-CLINIC / non-FARM organization (400)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const store = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_STORE',
      name: 'Supplies',
    });
    const user = await registerUser(app);
    const res = await request(app)
      .post(`/api/v1/organizations/${store.id}/conversations`)
      .set(bearer(user.accessToken))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
  });
});

// --- Farm chat (Farm Owner ↔ member) -------------------------------

describe('farm chat — Farm Owner ↔ member', () => {
  async function farmSetup() {
    const admin = await registerAdmin(app);
    const farmOwner = await registerApprovedVet(app);
    const farmVet = await registerApprovedVet(app);
    const employee = await registerUser(app);
    const outsider = await registerApprovedVet(app);
    const farm = await createFarm(app, farmOwner.accessToken, admin.accessToken, {
      name: 'Delta Poultry',
    });
    await joinFarm(app, farmVet.accessToken, farm.joinCode);
    await addOrganizationMember(app, farmOwner.accessToken, farm.id, {
      userId: employee.id,
      role: 'STAFF',
    });
    return { admin, farmOwner, farmVet, employee, outsider, farm };
  }

  it('the farm owner chats with an assigned veterinarian and an assigned employee', async () => {
    const { farmOwner, farmVet, employee, farm } = await farmSetup();

    const withVet = await startConversation(app, farmOwner.accessToken, farm.id, farmVet.id);
    expect(withVet.type).toBe('FARM_OWNER_MEMBER');
    expect(withVet.counterpartUserId).toBe(farmVet.id);
    expect(withVet.viewerSide).toBe('FARM_OWNER');

    const withEmployee = await startConversation(app, farmOwner.accessToken, farm.id, employee.id);
    expect(withEmployee.counterpartUserId).toBe(employee.id);
    expect(withEmployee.id).not.toBe(withVet.id);

    // the member side can see & reply to their own conversation
    const vetView = await request(app)
      .get(`/api/v1/conversations/${withVet.id}`)
      .set(bearer(farmVet.accessToken));
    expect(vetView.status).toBe(200);
    expect(vetView.body.data.viewerSide).toBe('FARM_MEMBER');

    const s1 = await sendChatMessage(app, farmOwner.accessToken, withVet.id, 'Check shed 3 today');
    expect(s1.status).toBe(201);
    const s2 = await sendChatMessage(app, farmVet.accessToken, withVet.id, 'On it');
    expect(s2.status).toBe(201);
  });

  it('a farm member can open their own conversation with the owner (no target)', async () => {
    const { farmVet, farm, farmOwner } = await farmSetup();
    const conv = await startConversation(app, farmVet.accessToken, farm.id);
    expect(conv.type).toBe('FARM_OWNER_MEMBER');
    expect(conv.counterpartUserId).toBe(farmVet.id);
    // owner sees the same conversation
    const ownerView = await request(app)
      .get(`/api/v1/conversations/${conv.id}`)
      .set(bearer(farmOwner.accessToken));
    expect(ownerView.status).toBe(200);
    expect(ownerView.body.data.viewerSide).toBe('FARM_OWNER');
  });

  it('the farm owner cannot start a conversation with an unrelated (non-member) veterinarian', async () => {
    const { farmOwner, outsider, farm } = await farmSetup();
    const res = await request(app)
      .post(`/api/v1/organizations/${farm.id}/conversations`)
      .set(bearer(farmOwner.accessToken))
      .send({ targetUserId: outsider.id });
    expect(res.status).toBe(400);
  });

  it('an unrelated veterinarian cannot start a farm conversation at all', async () => {
    const { outsider, farm } = await farmSetup();
    const res = await request(app)
      .post(`/api/v1/organizations/${farm.id}/conversations`)
      .set(bearer(outsider.accessToken))
      .send({});
    expect(res.status).toBe(403);
  });

  it('there is no member ↔ member conversation: a second member cannot see the first member’s thread', async () => {
    const { farmOwner, farmVet, employee, farm } = await farmSetup();
    const conv = await startConversation(app, farmOwner.accessToken, farm.id, farmVet.id);
    // employee (another farm member) is not a participant and is not the owner
    const res = await request(app)
      .get(`/api/v1/conversations/${conv.id}`)
      .set(bearer(employee.accessToken));
    expect(res.status).toBe(404);
    const send = await sendChatMessage(app, employee.accessToken, conv.id, 'let me in');
    expect(send.status).toBe(404);
  });
});

// --- IDOR / cross-conversation isolation ---------------------------

describe('chat — IDOR & cross-conversation isolation', () => {
  it('another pet owner cannot read, message, or mark-read someone else’s clinic conversation', async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic A',
    });
    const ownerA = await registerUser(app);
    const ownerB = await registerUser(app);

    const convA = await startConversation(app, ownerA.accessToken, clinic.id);
    const msg = await sendChatMessage(app, ownerA.accessToken, convA.id, 'private');
    const messageId = msg.body.data.id as string;

    expect(
      (await request(app).get(`/api/v1/conversations/${convA.id}`).set(bearer(ownerB.accessToken)))
        .status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/v1/conversations/${convA.id}/messages`)
          .set(bearer(ownerB.accessToken))
      ).status,
    ).toBe(404);
    expect((await sendChatMessage(app, ownerB.accessToken, convA.id, 'hi')).status).toBe(404);
    expect((await markConversationRead(app, ownerB.accessToken, convA.id, messageId)).status).toBe(
      404,
    );
  });

  it('a clinic member of another clinic cannot access this clinic’s conversation', async () => {
    const admin = await registerAdmin(app);
    const ownerA = await registerApprovedVet(app);
    const ownerB = await registerApprovedVet(app);
    const clinicA = await createActiveOrganization(app, ownerA.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic A',
    });
    await createActiveOrganization(app, ownerB.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic B',
    });
    const petOwner = await registerUser(app);
    const conv = await startConversation(app, petOwner.accessToken, clinicA.id);

    // ownerB runs Clinic B, has no membership in Clinic A
    const res = await request(app)
      .get(`/api/v1/conversations/${conv.id}`)
      .set(bearer(ownerB.accessToken));
    expect(res.status).toBe(404);
  });

  it('a plain admin who is not a participant cannot read a private conversation via user endpoints', async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic',
    });
    const petOwner = await registerUser(app);
    const conv = await startConversation(app, petOwner.accessToken, clinic.id);
    const res = await request(app)
      .get(`/api/v1/conversations/${conv.id}`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(404);
  });

  it('a user cannot delete a message they did not send', async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic',
    });
    const petOwner = await registerUser(app);
    const conv = await startConversation(app, petOwner.accessToken, clinic.id);
    const msg = await sendChatMessage(app, petOwner.accessToken, conv.id, 'mine');
    const messageId = msg.body.data.id as string;

    // clinic owner is a participant (clinic side) but not the sender
    const res = await deleteChatMessage(app, vetOwner.accessToken, messageId);
    expect(res.status).toBe(403);
  });

  it('sender spoofing is impossible — senderUserId in the body is ignored', async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic',
    });
    const petOwner = await registerUser(app);
    const conv = await startConversation(app, petOwner.accessToken, clinic.id);
    const res = await request(app)
      .post(`/api/v1/conversations/${conv.id}/messages`)
      .set(bearer(petOwner.accessToken))
      .send({ body: 'x', senderUserId: vetOwner.id });
    // strict schema rejects the unknown key
    expect(res.status).toBe(422);
  });
});

// --- membership changes ------------------------------------------

describe('chat — authorization follows CURRENT membership state', () => {
  it('a suspended / removed / left farm member loses access; the owner keeps it', async () => {
    const admin = await registerAdmin(app);
    const farmOwner = await registerApprovedVet(app);
    const farmVet = await registerApprovedVet(app);
    const farm = await createFarm(app, farmOwner.accessToken, admin.accessToken, { name: 'Farm' });
    await joinFarm(app, farmVet.accessToken, farm.joinCode);
    const conv = await startConversation(app, farmOwner.accessToken, farm.id, farmVet.id);
    await sendChatMessage(app, farmVet.accessToken, conv.id, 'active member message');

    for (const status of ['SUSPENDED', 'REMOVED', 'LEFT']) {
      await setMembershipStatus(farmVet.id, farm.id, status);
      const view = await request(app)
        .get(`/api/v1/conversations/${conv.id}`)
        .set(bearer(farmVet.accessToken));
      expect(view.status, `status=${status}`).toBe(404);
      const send = await sendChatMessage(app, farmVet.accessToken, conv.id, 'still here?');
      expect(send.status, `status=${status}`).toBe(404);
      // the owner is unaffected
      const ownerView = await request(app)
        .get(`/api/v1/conversations/${conv.id}`)
        .set(bearer(farmOwner.accessToken));
      expect(ownerView.status).toBe(200);
    }

    // reinstated → access returns
    await setMembershipStatus(farmVet.id, farm.id, 'ACTIVE');
    const back = await request(app)
      .get(`/api/v1/conversations/${conv.id}`)
      .set(bearer(farmVet.accessToken));
    expect(back.status).toBe(200);
  });

  it('a suspended clinic member loses access to the clinic’s conversations', async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const clinicVet = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic',
    });
    await addOrganizationMember(app, vetOwner.accessToken, clinic.id, {
      userId: clinicVet.id,
      role: 'VETERINARIAN',
    });
    const petOwner = await registerUser(app);
    const conv = await startConversation(app, petOwner.accessToken, clinic.id);

    expect(
      (
        await request(app)
          .get(`/api/v1/conversations/${conv.id}`)
          .set(bearer(clinicVet.accessToken))
      ).status,
    ).toBe(200);

    await setMembershipStatus(clinicVet.id, clinic.id, 'SUSPENDED');
    expect(
      (
        await request(app)
          .get(`/api/v1/conversations/${conv.id}`)
          .set(bearer(clinicVet.accessToken))
      ).status,
    ).toBe(404);
  });
});

// --- messages: pagination, delete, unread ------------------------

describe('chat — messages: ordering, pagination, soft delete, unread', () => {
  async function convWithMessages() {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic',
    });
    const petOwner = await registerUser(app);
    const conv = await startConversation(app, petOwner.accessToken, clinic.id);
    return { admin, vetOwner, clinic, petOwner, conv };
  }

  it('paginates deterministically, newest first', async () => {
    const { vetOwner, petOwner, conv } = await convWithMessages();
    for (let i = 1; i <= 5; i += 1) {
      const who = i % 2 === 0 ? vetOwner : petOwner;
      const r = await sendChatMessage(app, who.accessToken, conv.id, `msg ${i}`);
      expect(r.status).toBe(201);
    }
    const p1 = await listChatMessages(app, petOwner.accessToken, conv.id, { page: 1, pageSize: 2 });
    expect(p1.body.data.map((m: { body: string }) => m.body)).toEqual(['msg 5', 'msg 4']);
    expect(p1.body.meta.total).toBe(5);
    const p3 = await listChatMessages(app, petOwner.accessToken, conv.id, { page: 3, pageSize: 2 });
    expect(p3.body.data.map((m: { body: string }) => m.body)).toEqual(['msg 1']);
  });

  it('soft-deletes the sender’s own message: row kept, body nulled, ordering intact', async () => {
    const { petOwner, conv } = await convWithMessages();
    await sendChatMessage(app, petOwner.accessToken, conv.id, 'one');
    const two = await sendChatMessage(app, petOwner.accessToken, conv.id, 'two');
    await sendChatMessage(app, petOwner.accessToken, conv.id, 'three');
    const messageId = two.body.data.id as string;

    const del = await deleteChatMessage(app, petOwner.accessToken, messageId);
    expect(del.status).toBe(200);
    expect(del.body.data.body).toBeNull();
    expect(del.body.data.deletedAt).not.toBeNull();

    // idempotent
    expect((await deleteChatMessage(app, petOwner.accessToken, messageId)).status).toBe(200);

    const list = await listChatMessages(app, petOwner.accessToken, conv.id);
    expect(list.body.data.map((m: { body: string | null }) => m.body)).toEqual([
      'three',
      null,
      'one',
    ]);
    expect(list.body.meta.total).toBe(3);
  });

  it('tracks unread counts per participant and clears them on read', async () => {
    const { vetOwner, petOwner, conv } = await convWithMessages();
    await sendChatMessage(app, vetOwner.accessToken, conv.id, 'a');
    const b = await sendChatMessage(app, vetOwner.accessToken, conv.id, 'b');

    const list = await listConversations(app, petOwner.accessToken);
    const mine = (list.body.data as Array<{ id: string; unreadCount: number | null }>).find(
      (c) => c.id === conv.id,
    );
    expect(mine?.unreadCount).toBe(2);

    const read = await markConversationRead(
      app,
      petOwner.accessToken,
      conv.id,
      b.body.data.id as string,
    );
    expect(read.status).toBe(200);
    expect(read.body.data.unreadCount).toBe(0);

    // the pet owner's own message never counts as unread for them
    await sendChatMessage(app, petOwner.accessToken, conv.id, 'c');
    const after = await request(app)
      .get(`/api/v1/conversations/${conv.id}`)
      .set(bearer(petOwner.accessToken));
    expect(after.body.data.unreadCount).toBe(0);
  });

  it('rejects an empty body (422) and a body over the limit (422)', async () => {
    const { petOwner, conv } = await convWithMessages();
    expect((await sendChatMessage(app, petOwner.accessToken, conv.id, '   ')).status).toBe(422);
    expect(
      (await sendChatMessage(app, petOwner.accessToken, conv.id, 'x'.repeat(4001))).status,
    ).toBe(422);
  });

  it('mark-read with a message from another conversation is 400', async () => {
    const { vetOwner, clinic, petOwner, conv } = await convWithMessages();
    const other = await registerUser(app);
    const otherConv = await startConversation(app, other.accessToken, clinic.id);
    const stray = await sendChatMessage(app, other.accessToken, otherConv.id, 'x');
    void vetOwner;
    const res = await markConversationRead(
      app,
      petOwner.accessToken,
      conv.id,
      stray.body.data.id as string,
    );
    expect(res.status).toBe(400);
  });
});

// --- conversation listing --------------------------------------

describe('chat — conversation listing', () => {
  it('lists a user’s own conversations and a clinic member sees the clinic’s conversations', async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic',
    });
    const p1 = await registerUser(app);
    const p2 = await registerUser(app);
    const c1 = await startConversation(app, p1.accessToken, clinic.id);
    const c2 = await startConversation(app, p2.accessToken, clinic.id);
    await sendChatMessage(app, p1.accessToken, c1.id, 'hi from p1');

    const p1List = await listConversations(app, p1.accessToken);
    expect(p1List.body.data.map((c: { id: string }) => c.id)).toEqual([c1.id]);

    const clinicList = await listConversations(app, vetOwner.accessToken);
    const ids = (clinicList.body.data as Array<{ id: string }>).map((c) => c.id).sort();
    expect(ids).toEqual([c1.id, c2.id].sort());
    // clinic-side rows report unreadCount: null
    expect(
      (clinicList.body.data as Array<{ unreadCount: number | null }>).every(
        (c) => c.unreadCount === null,
      ),
    ).toBe(true);
  });
});

// --- events & audit ------------------------------------------

describe('chat — domain events & audit', () => {
  it('emits chat.conversation.created + CONVERSATION_CREATED audit, chat.message.created (no audit), chat.message.deleted + MESSAGE_DELETED audit', async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic',
    });
    const petOwner = await registerUser(app);

    const conv = await startConversation(app, petOwner.accessToken, clinic.id);
    const sent = await sendChatMessage(app, petOwner.accessToken, conv.id, 'secret token abc');
    const messageId = sent.body.data.id as string;
    await deleteChatMessage(app, petOwner.accessToken, messageId);
    await tick();

    expect(captured).toEqual([
      'chat.conversation.created',
      'chat.message.created',
      'chat.message.deleted',
    ]);

    const convAudit = await auditRows(conv.id);
    expect(convAudit.map((r) => r.action)).toEqual(['CONVERSATION_CREATED']);
    const [convRow] = convAudit;
    expect(convRow?.actor_user_id).toBe(petOwner.id);
    expect(convRow?.metadata).toMatchObject({
      organizationId: clinic.id,
      type: 'PET_OWNER_CLINIC',
    });

    const msgAudit = await auditRows(messageId);
    expect(msgAudit.map((r) => r.action)).toEqual(['MESSAGE_DELETED']);
    // normal messages are NOT audited, and no message body / secrets are stored
    expect(JSON.stringify(msgAudit)).not.toContain('secret token abc');
    expect(JSON.stringify(msgAudit)).not.toContain('password');
  });

  it('a failed send (inactive organization) writes no message and emits no event', async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic',
    });
    const petOwner = await registerUser(app);
    const conv = await startConversation(app, petOwner.accessToken, clinic.id);
    captured.length = 0;

    // suspend the clinic
    await getTestDb()('organizations').where({ id: clinic.id }).update({ status: 'SUSPENDED' });

    const res = await sendChatMessage(app, petOwner.accessToken, conv.id, 'are you there');
    expect(res.status).toBe(403);
    await tick();
    expect(captured).not.toContain('chat.message.created');
    const count = await getTestDb()('messages').where({ conversation_id: conv.id }).count();
    expect(Number((count[0] as { count: string }).count)).toBe(0);
  });
});

// --- concurrency ---------------------------------------------

describe('chat — concurrent conversation creation is de-duplicated', () => {
  it('two simultaneous "start conversation" calls yield ONE conversation', async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic',
    });
    const petOwner = await registerUser(app);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post(`/api/v1/organizations/${clinic.id}/conversations`)
          .set(bearer(petOwner.accessToken))
          .send({}),
      ),
    );
    for (const r of results) expect([200, 201]).toContain(r.status);
    const ids = new Set(results.map((r) => r.body.data.id as string));
    expect(ids.size).toBe(1);

    const rows = await getTestDb()('conversations').where({ organization_id: clinic.id });
    expect(rows).toHaveLength(1);
  });
});
