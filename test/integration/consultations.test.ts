import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { DomainEvent } from '../../src/shared/events/index.js';
import { ALL_EVENTS } from '../../src/shared/events/index.js';
import type { AiResponderPort } from '../../src/modules/consultations/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createAnimal,
  createConsultation,
  closeThread,
  blockThreadSender,
  listThreadMessages,
  registerAdmin,
  registerApprovedVet,
  registerSupportSupervisor,
  registerUser,
  sendThreadMessage,
  setAiSettings,
} from '../helpers/factories.js';

/** Configurable AI stub — the real provider is Phase 14+. */
class StubAiResponder implements AiResponderPort {
  mode: 'reply' | 'null' | 'throw' = 'reply';
  calls = 0;
  generate(): Promise<string | null> {
    this.calls += 1;
    if (this.mode === 'throw') return Promise.reject(new Error('stub AI failure'));
    if (this.mode === 'null') return Promise.resolve(null);
    return Promise.resolve('AI: here is some general guidance.');
  }
}

const ai = new StubAiResponder();
const { app, container } = buildTestApp({ aiResponder: ai });

const events: string[] = [];
container.eventBus.subscribe(ALL_EVENTS, (e: DomainEvent) => {
  if (e.name.startsWith('consultation.') || e.name.startsWith('ai.')) events.push(e.name);
});
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  await getTestDb()('ai_settings').update({ enabled: false });
  ai.mode = 'reply';
  ai.calls = 0;
  events.length = 0;
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

describe('consultations — creation & creator flow', () => {
  it('a pet owner creates a consultation, reads it, and messages it while OPEN', async () => {
    const owner = await registerUser(app);
    const create = await createConsultation(app, owner.accessToken, 'My cat stopped eating');
    expect(create.status).toBe(201);
    expect(create.body.data).toMatchObject({
      kind: 'CONSULTATION',
      status: 'OPEN',
      createdByUserId: owner.id,
      animalId: null,
      senderBlocked: false,
      aiResponded: false,
    });
    const id = create.body.data.id as string;

    const get = await request(app)
      .get(`/api/v1/consultations/${id}`)
      .set(bearer(owner.accessToken));
    expect(get.status).toBe(200);

    const msg = await sendThreadMessage(
      app,
      owner.accessToken,
      'consultations',
      id,
      'still not eating',
    );
    expect(msg.status).toBe(201);
    expect(msg.body.data).toMatchObject({ source: 'USER', senderUserId: owner.id });
    expect(msg.body.data.consultationId).toBe(id);

    const list = await listThreadMessages(app, owner.accessToken, 'consultations', id);
    expect(list.body.data.map((m: { body: string }) => m.body)).toEqual([
      'My cat stopped eating',
      'still not eating',
    ]);
    expect(list.body.meta.total).toBe(2);
  });

  it('rejects unauthenticated creation (401) and unknown body fields (422)', async () => {
    await request(app).post('/api/v1/consultations').send({ body: 'hi' }).expect(401);
    const owner = await registerUser(app);
    await request(app)
      .post('/api/v1/consultations')
      .set(bearer(owner.accessToken))
      .send({ body: 'hi', createdByUserId: 'x', senderType: 'ADMIN' })
      .expect(422);
    await request(app)
      .post('/api/v1/consultations')
      .set(bearer(owner.accessToken))
      .send({ body: '   ' })
      .expect(422);
  });

  it('accepts an owned-animal reference and rejects one the caller does not own', async () => {
    const owner = await registerUser(app);
    const other = await registerUser(app);
    const mine = await createAnimal(app, owner.accessToken, { name: 'Milo' });
    const theirs = await createAnimal(app, other.accessToken, { name: 'Rex' });

    const ok = await createConsultation(app, owner.accessToken, 'about Milo', mine.id);
    expect(ok.status).toBe(201);
    expect(ok.body.data.animalId).toBe(mine.id);

    const bad = await createConsultation(app, owner.accessToken, 'about Rex', theirs.id);
    expect(bad.status).toBe(400);
  });
});

describe('consultations — authorization & IDOR', () => {
  it('another pet owner cannot read, message, or close a consultation', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const c = await createConsultation(app, a.accessToken, 'private');
    const id = c.body.data.id as string;

    expect(
      (await request(app).get(`/api/v1/consultations/${id}`).set(bearer(b.accessToken))).status,
    ).toBe(404);
    expect((await listThreadMessages(app, b.accessToken, 'consultations', id)).status).toBe(404);
    expect((await sendThreadMessage(app, b.accessToken, 'consultations', id, 'hi')).status).toBe(
      404,
    );
    expect((await closeThread(app, b.accessToken, 'consultations', id)).status).toBe(404);
  });

  it('the responsible CONSULTATION supervisor can read, respond and close; an INQUIRY supervisor cannot', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const consultationSup = await registerSupportSupervisor(app, admin.accessToken, 'CONSULTATION');
    const inquirySup = await registerSupportSupervisor(app, admin.accessToken, 'INQUIRY');

    const c = await createConsultation(app, owner.accessToken, 'help please');
    const id = c.body.data.id as string;

    // INQUIRY supervisor is not a responder for consultations → 404
    expect(
      (await request(app).get(`/api/v1/consultations/${id}`).set(bearer(inquirySup.accessToken)))
        .status,
    ).toBe(404);
    expect(
      (await sendThreadMessage(app, inquirySup.accessToken, 'consultations', id, 'nope')).status,
    ).toBe(404);

    // CONSULTATION supervisor: full responder rights
    const read = await request(app)
      .get(`/api/v1/consultations/${id}`)
      .set(bearer(consultationSup.accessToken));
    expect(read.status).toBe(200);

    const reply = await sendThreadMessage(
      app,
      consultationSup.accessToken,
      'consultations',
      id,
      'Bring the cat in tomorrow',
    );
    expect(reply.status).toBe(201);
    expect(reply.body.data).toMatchObject({
      source: 'SUPERVISOR',
      senderUserId: consultationSup.id,
    });

    const close = await closeThread(app, consultationSup.accessToken, 'consultations', id);
    expect(close.status).toBe(200);
    expect(close.body.data.status).toBe('CLOSED');
  });

  it('an INACTIVE (deactivated) CONSULTATION supervisor loses responder access', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const sup = await registerApprovedVet(app);
    const assign = await request(app)
      .post('/api/v1/admin/supervisors')
      .set(bearer(admin.accessToken))
      .send({ userId: sup.id, domain: 'CONSULTATION' });
    const assignmentId = assign.body.data.id as string;

    const c = await createConsultation(app, owner.accessToken, 'q');
    const id = c.body.data.id as string;
    expect(
      (await request(app).get(`/api/v1/consultations/${id}`).set(bearer(sup.accessToken))).status,
    ).toBe(200);

    await request(app)
      .delete(`/api/v1/admin/supervisors/${assignmentId}`)
      .set(bearer(admin.accessToken))
      .expect(200);

    expect(
      (await request(app).get(`/api/v1/consultations/${id}`).set(bearer(sup.accessToken))).status,
    ).toBe(404);
  });

  it('a CONSULTATION supervisor whose vet approval is revoked loses responder access', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const sup = await registerSupportSupervisor(app, admin.accessToken, 'CONSULTATION');
    const c = await createConsultation(app, owner.accessToken, 'q');
    const id = c.body.data.id as string;
    expect(
      (await request(app).get(`/api/v1/consultations/${id}`).set(bearer(sup.accessToken))).status,
    ).toBe(200);

    await getTestDb()('users').where({ id: sup.id }).update({ veterinarian_status: 'REJECTED' });
    expect(
      (await request(app).get(`/api/v1/consultations/${id}`).set(bearer(sup.accessToken))).status,
    ).toBe(404);
  });

  it('a plain admin has full access via the ADMIN override; their reply source is ADMIN', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const c = await createConsultation(app, owner.accessToken, 'q');
    const id = c.body.data.id as string;

    expect(
      (await request(app).get(`/api/v1/consultations/${id}`).set(bearer(admin.accessToken))).status,
    ).toBe(200);
    const reply = await sendThreadMessage(
      app,
      admin.accessToken,
      'consultations',
      id,
      'admin here',
    );
    expect(reply.status).toBe(201);
    expect(reply.body.data.source).toBe('ADMIN');

    const adminList = await request(app)
      .get('/api/v1/admin/consultations')
      .set(bearer(admin.accessToken));
    expect(adminList.status).toBe(200);
    expect(adminList.body.data.map((t: { id: string }) => t.id)).toContain(id);
  });

  it('a non-supervisor cannot reach the admin listing (403)', async () => {
    const owner = await registerUser(app);
    await request(app)
      .get('/api/v1/admin/consultations')
      .set(bearer(owner.accessToken))
      .expect(403);
  });
});

describe('consultations — lifecycle', () => {
  it('after CLOSE the creator cannot send (409 THREAD_NOT_WRITABLE); close is idempotent', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const c = await createConsultation(app, owner.accessToken, 'q');
    const id = c.body.data.id as string;

    const first = await closeThread(app, admin.accessToken, 'consultations', id);
    expect(first.status).toBe(200);
    const again = await closeThread(app, admin.accessToken, 'consultations', id);
    expect(again.status).toBe(200); // idempotent

    const send = await sendThreadMessage(
      app,
      owner.accessToken,
      'consultations',
      id,
      'still there?',
    );
    expect(send.status).toBe(409);
    expect(send.body.error.code).toBe('THREAD_NOT_WRITABLE');

    // a responder also cannot post to a CLOSED thread
    expect(
      (await sendThreadMessage(app, admin.accessToken, 'consultations', id, 'reopen?')).status,
    ).toBe(409);
    // …but can still READ it
    expect(
      (await request(app).get(`/api/v1/consultations/${id}`).set(bearer(admin.accessToken))).status,
    ).toBe(200);
  });

  it('the creator cannot close their own consultation (only responders may)', async () => {
    const owner = await registerUser(app);
    const c = await createConsultation(app, owner.accessToken, 'q');
    const id = c.body.data.id as string;
    const res = await closeThread(app, owner.accessToken, 'consultations', id);
    expect(res.status).toBe(403);
  });

  it('block-sender makes the creator read-only while the thread stays OPEN for responders', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const c = await createConsultation(app, owner.accessToken, 'q');
    const id = c.body.data.id as string;

    const block = await blockThreadSender(app, admin.accessToken, 'consultations', id, true);
    expect(block.status).toBe(200);
    expect(block.body.data.senderBlocked).toBe(true);
    expect(block.body.data.status).toBe('OPEN');

    expect(
      (await sendThreadMessage(app, owner.accessToken, 'consultations', id, 'let me talk')).status,
    ).toBe(403);
    // responder still can
    expect(
      (await sendThreadMessage(app, admin.accessToken, 'consultations', id, 'we are reviewing'))
        .status,
    ).toBe(201);
    // creator can still READ
    expect(
      (await request(app).get(`/api/v1/consultations/${id}`).set(bearer(owner.accessToken))).status,
    ).toBe(200);

    const unblock = await blockThreadSender(app, admin.accessToken, 'consultations', id, false);
    expect(unblock.body.data.senderBlocked).toBe(false);
    expect(
      (await sendThreadMessage(app, owner.accessToken, 'consultations', id, 'thanks')).status,
    ).toBe(201);
  });

  it('a creator cannot block their own thread', async () => {
    const owner = await registerUser(app);
    const c = await createConsultation(app, owner.accessToken, 'q');
    const id = c.body.data.id as string;
    expect(
      (await blockThreadSender(app, owner.accessToken, 'consultations', id, true)).status,
    ).toBe(403);
  });
});

describe('consultations — AI response flow', () => {
  it('AI disabled → no AI message and the responder is never called', async () => {
    const owner = await registerUser(app);
    const c = await createConsultation(app, owner.accessToken, 'q');
    const id = c.body.data.id as string;
    await tick();

    expect(ai.calls).toBe(0);
    const list = await listThreadMessages(app, owner.accessToken, 'consultations', id);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].source).toBe('USER');
    expect(events).toEqual(['consultation.created']);
  });

  it('AI enabled → an AI message is generated through the abstraction, after commit', async () => {
    const admin = await registerAdmin(app);
    await setAiSettings(app, admin.accessToken, { consultationAiEnabled: true });
    expect(events).toContain('ai.settings.updated');

    const owner = await registerUser(app);
    const c = await createConsultation(app, owner.accessToken, 'my dog is limping');
    const id = c.body.data.id as string;

    expect(ai.calls).toBe(1);
    expect(c.body.data.aiResponded).toBe(true);

    const list = await listThreadMessages(app, owner.accessToken, 'consultations', id);
    expect(
      list.body.data.map((m: { source: string; senderUserId: string | null }) => m.source),
    ).toEqual(['USER', 'AI']);
    const aiMsg = list.body.data[1];
    expect(aiMsg.senderUserId).toBeNull();
    expect(aiMsg.body).toContain('AI:');

    await tick();
    expect(events).toEqual(
      expect.arrayContaining(['consultation.created', 'consultation.message.created']),
    );
  });

  it('AI failure does not corrupt the consultation (thread + first message still there)', async () => {
    const admin = await registerAdmin(app);
    await setAiSettings(app, admin.accessToken, { consultationAiEnabled: true });
    ai.mode = 'throw';

    const owner = await registerUser(app);
    const c = await createConsultation(app, owner.accessToken, 'help');
    expect(c.status).toBe(201);
    const id = c.body.data.id as string;

    const list = await listThreadMessages(app, owner.accessToken, 'consultations', id);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].source).toBe('USER');
    // the consultation is still fully usable
    expect(
      (await sendThreadMessage(app, owner.accessToken, 'consultations', id, 'anyone?')).status,
    ).toBe(201);
  });

  it('AI enabled but the provider returns null → no AI message', async () => {
    const admin = await registerAdmin(app);
    await setAiSettings(app, admin.accessToken, { consultationAiEnabled: true });
    ai.mode = 'null';

    const owner = await registerUser(app);
    const c = await createConsultation(app, owner.accessToken, 'hello');
    const id = c.body.data.id as string;
    expect(ai.calls).toBe(1);
    const list = await listThreadMessages(app, owner.accessToken, 'consultations', id);
    expect(list.body.data).toHaveLength(1);
  });

  it('only an admin can change AI settings', async () => {
    const owner = await registerUser(app);
    const sup = await (async () => {
      const admin = await registerAdmin(app);
      return registerSupportSupervisor(app, admin.accessToken, 'CONSULTATION');
    })();
    await request(app)
      .patch('/api/v1/admin/ai-settings')
      .set(bearer(owner.accessToken))
      .send({ consultationAiEnabled: true })
      .expect(403);
    // even a consultation supervisor cannot (ai.settings.manage is ADMIN-only)
    await request(app)
      .patch('/api/v1/admin/ai-settings')
      .set(bearer(sup.accessToken))
      .send({ consultationAiEnabled: true })
      .expect(403);
  });
});

describe('consultations — pagination', () => {
  it('paginates the message list deterministically (oldest first)', async () => {
    const owner = await registerUser(app);
    const c = await createConsultation(app, owner.accessToken, 'msg 0');
    const id = c.body.data.id as string;
    for (let i = 1; i <= 4; i += 1) {
      await sendThreadMessage(app, owner.accessToken, 'consultations', id, `msg ${i}`);
    }
    const p1 = await listThreadMessages(app, owner.accessToken, 'consultations', id, {
      page: 1,
      pageSize: 2,
    });
    expect(p1.body.data.map((m: { body: string }) => m.body)).toEqual(['msg 0', 'msg 1']);
    expect(p1.body.meta.total).toBe(5);
    const p3 = await listThreadMessages(app, owner.accessToken, 'consultations', id, {
      page: 3,
      pageSize: 2,
    });
    expect(p3.body.data.map((m: { body: string }) => m.body)).toEqual(['msg 4']);
  });

  it("lists only the caller's own consultations", async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const c1 = await createConsultation(app, a.accessToken, 'a1');
    await createConsultation(app, b.accessToken, 'b1');
    const list = await request(app).get('/api/v1/consultations').set(bearer(a.accessToken));
    expect(list.body.data.map((t: { id: string }) => t.id)).toEqual([c1.body.data.id]);
  });
});

describe('consultations — audit', () => {
  it('audits CONSULTATION_CREATED / CONSULTATION_CLOSED / block toggles with the right actor, no message bodies', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const c = await createConsultation(app, owner.accessToken, 'secret medical detail xyz');
    const id = c.body.data.id as string;
    await sendThreadMessage(app, owner.accessToken, 'consultations', id, 'another secret xyz');
    await blockThreadSender(app, admin.accessToken, 'consultations', id, true);
    await blockThreadSender(app, admin.accessToken, 'consultations', id, false);
    await closeThread(app, admin.accessToken, 'consultations', id);

    const rows = await auditRows(id);
    expect(rows.map((r) => r.action)).toEqual([
      'CONSULTATION_CREATED',
      'CONSULTATION_SENDER_BLOCKED',
      'CONSULTATION_SENDER_UNBLOCKED',
      'CONSULTATION_CLOSED',
    ]);
    const [created] = rows;
    expect(created?.actor_user_id).toBe(owner.id);
    // normal messages are NOT audited, and no body / secret leaks into metadata
    expect(JSON.stringify(rows)).not.toContain('secret');
    expect(JSON.stringify(rows)).not.toContain('password');
  });

  it('a rejected create (spoofed field) writes no consultation and no audit', async () => {
    const owner = await registerUser(app);
    await request(app)
      .post('/api/v1/consultations')
      .set(bearer(owner.accessToken))
      .send({ body: 'x', senderUserId: owner.id })
      .expect(422);
    const count = await getTestDb()('consultations').count();
    expect(Number((count[0] as { count: string }).count)).toBe(0);
  });
});
