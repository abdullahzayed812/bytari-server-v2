import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { DomainEvent } from '../../src/shared/events/index.js';
import { ALL_EVENTS } from '../../src/shared/events/index.js';
import type { AiResponderPort } from '../../src/modules/consultations/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  closeThread,
  createInquiry,
  listThreadMessages,
  registerAdmin,
  registerApprovedVet,
  registerPendingVet,
  registerRejectedVet,
  registerSupportSupervisor,
  registerUser,
  sendThreadMessage,
  setAiSettings,
} from '../helpers/factories.js';

class StubAiResponder implements AiResponderPort {
  mode: 'reply' | 'null' | 'throw' = 'reply';
  calls = 0;
  generate(): Promise<string | null> {
    this.calls += 1;
    if (this.mode === 'throw') return Promise.reject(new Error('stub AI failure'));
    if (this.mode === 'null') return Promise.resolve(null);
    return Promise.resolve('AI: consider a differential diagnosis.');
  }
}

const ai = new StubAiResponder();
const { app, container } = buildTestApp({ aiResponder: ai });

const events: string[] = [];
container.eventBus.subscribe(ALL_EVENTS, (e: DomainEvent) => {
  if (e.name.startsWith('inquiry.')) events.push(e.name);
});

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  await getTestDb()('ai_settings').update({ enabled: false });
  ai.mode = 'reply';
  ai.calls = 0;
  events.length = 0;
});
afterAll(() => closeTestDb());

describe('inquiries — creator eligibility', () => {
  it('an approved veterinarian creates an inquiry', async () => {
    const vet = await registerApprovedVet(app);
    const res = await createInquiry(app, vet.accessToken, 'What antibiotic for a feline URI?');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      kind: 'INQUIRY',
      status: 'OPEN',
      createdByUserId: vet.id,
    });
  });

  it('a non-veterinarian is rejected (403)', async () => {
    const user = await registerUser(app);
    expect((await createInquiry(app, user.accessToken, 'hi')).status).toBe(403);
  });

  it('a pending / rejected veterinarian is rejected (403)', async () => {
    const pending = await registerPendingVet(app);
    const rejected = await registerRejectedVet(app);
    expect((await createInquiry(app, pending.accessToken, 'hi')).status).toBe(403);
    expect((await createInquiry(app, rejected.accessToken, 'hi')).status).toBe(403);
  });

  it('the inquiry body cannot carry a spoofed sender (422) and unauthenticated is 401', async () => {
    await request(app).post('/api/v1/inquiries').send({ body: 'x' }).expect(401);
    const vet = await registerApprovedVet(app);
    await request(app)
      .post('/api/v1/inquiries')
      .set(bearer(vet.accessToken))
      .send({ body: 'x', senderUserId: vet.id })
      .expect(422);
  });
});

describe('inquiries — authorization & domain separation', () => {
  it('another veterinarian cannot access the inquiry', async () => {
    const v1 = await registerApprovedVet(app);
    const v2 = await registerApprovedVet(app);
    const i = await createInquiry(app, v1.accessToken, 'mine');
    const id = i.body.data.id as string;
    expect(
      (await request(app).get(`/api/v1/inquiries/${id}`).set(bearer(v2.accessToken))).status,
    ).toBe(404);
    expect(
      (await sendThreadMessage(app, v2.accessToken, 'inquiries', id, 'let me in')).status,
    ).toBe(404);
  });

  it('the responsible INQUIRY supervisor can respond; a CONSULTATION supervisor cannot', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const inquirySup = await registerSupportSupervisor(app, admin.accessToken, 'INQUIRY');
    const consultationSup = await registerSupportSupervisor(app, admin.accessToken, 'CONSULTATION');

    const i = await createInquiry(app, vet.accessToken, 'dosage question');
    const id = i.body.data.id as string;

    expect(
      (await request(app).get(`/api/v1/inquiries/${id}`).set(bearer(consultationSup.accessToken)))
        .status,
    ).toBe(404);

    const reply = await sendThreadMessage(
      app,
      inquirySup.accessToken,
      'inquiries',
      id,
      '10mg/kg BID',
    );
    expect(reply.status).toBe(201);
    expect(reply.body.data).toMatchObject({ source: 'SUPERVISOR', senderUserId: inquirySup.id });
    expect(reply.body.data.inquiryId).toBe(id);

    expect((await closeThread(app, inquirySup.accessToken, 'inquiries', id)).status).toBe(200);
  });

  it('admin can list all inquiries; an inquiry supervisor can too, a plain vet cannot', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const sup = await registerSupportSupervisor(app, admin.accessToken, 'INQUIRY');
    await createInquiry(app, vet.accessToken, 'q');

    expect(
      (await request(app).get('/api/v1/admin/inquiries').set(bearer(admin.accessToken))).status,
    ).toBe(200);
    expect(
      (await request(app).get('/api/v1/admin/inquiries').set(bearer(sup.accessToken))).status,
    ).toBe(200);
    expect(
      (await request(app).get('/api/v1/admin/inquiries').set(bearer(vet.accessToken))).status,
    ).toBe(403);
  });
});

describe('inquiries — lifecycle & AI', () => {
  it('after CLOSE the creator cannot post (409)', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const i = await createInquiry(app, vet.accessToken, 'q');
    const id = i.body.data.id as string;
    await closeThread(app, admin.accessToken, 'inquiries', id);
    const send = await sendThreadMessage(app, vet.accessToken, 'inquiries', id, 'follow-up');
    expect(send.status).toBe(409);
    expect(send.body.error.code).toBe('THREAD_NOT_WRITABLE');
  });

  it('AI disabled → no AI message; AI enabled → AI message via the abstraction', async () => {
    const vet = await registerApprovedVet(app);
    const off = await createInquiry(app, vet.accessToken, 'no ai please');
    expect(ai.calls).toBe(0);
    expect(
      (await listThreadMessages(app, vet.accessToken, 'inquiries', off.body.data.id as string)).body
        .data,
    ).toHaveLength(1);

    const admin = await registerAdmin(app);
    await setAiSettings(app, admin.accessToken, { inquiryAiEnabled: true });
    const on = await createInquiry(app, vet.accessToken, 'now with ai');
    expect(ai.calls).toBe(1);
    const msgs = await listThreadMessages(
      app,
      vet.accessToken,
      'inquiries',
      on.body.data.id as string,
    );
    expect(msgs.body.data.map((m: { source: string }) => m.source)).toEqual(['USER', 'AI']);
    expect(events).toContain('inquiry.message.created');
  });

  it('AI failure leaves the inquiry intact', async () => {
    const admin = await registerAdmin(app);
    await setAiSettings(app, admin.accessToken, { inquiryAiEnabled: true });
    ai.mode = 'throw';
    const vet = await registerApprovedVet(app);
    const i = await createInquiry(app, vet.accessToken, 'q');
    expect(i.status).toBe(201);
    expect(
      (await listThreadMessages(app, vet.accessToken, 'inquiries', i.body.data.id as string)).body
        .data,
    ).toHaveLength(1);
  });
});
