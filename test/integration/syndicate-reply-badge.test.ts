import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  assignOrganizationSupervisor,
  bearer,
  createSyndicate,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const api = (p: string): string => `/api/v1/syndicates${p}`;
const notif = (p: string): string => `/api/v1/notifications${p}`;

async function setup() {
  const admin = await registerAdmin(app);
  const syndicate = await createSyndicate(app, admin.accessToken, { name: 'نقابة أ' });
  const officer = await registerApprovedVet(app);
  await assignOrganizationSupervisor(app, admin.accessToken, syndicate.id, {
    userId: officer.id,
    permissions: ['syndicate.submission.read', 'syndicate.submission.respond'],
  });
  const member = await registerUser(app);
  return { syndicate, officer, member };
}

async function submitAndRespond(
  syndicateId: string,
  submitterToken: string,
  officerToken: string,
  body: Record<string, unknown>,
): Promise<string> {
  const created = await request(app)
    .post(api(`/${syndicateId}/submissions`))
    .set(bearer(submitterToken))
    .send(body);
  expect(created.status).toBe(201);
  const responded = await request(app)
    .post(api(`/${syndicateId}/submissions/${created.body.data.id}/respond`))
    .set(bearer(officerToken))
    .send({ responseText: 'تم الرد على طلبك.' });
  expect(responded.status).toBe(200);
  return created.body.data.id as string;
}

describe('"طلباتي واستفساراتي" — unseen syndicate replies badge', () => {
  it('counts replies to the caller’s own submissions per kind and clears one tab at a time', async () => {
    const { syndicate, officer, member } = await setup();
    await submitAndRespond(syndicate.id, member.accessToken, officer.accessToken, {
      kind: 'INQUIRY',
      message: 'ما هي متطلبات تجديد الهوية؟',
    });
    await submitAndRespond(syndicate.id, member.accessToken, officer.accessToken, {
      kind: 'INQUIRY',
      message: 'سؤال ثانٍ',
    });
    await submitAndRespond(syndicate.id, member.accessToken, officer.accessToken, {
      kind: 'REQUEST',
      requestType: 'ID_ISSUANCE',
      message: 'طلب إصدار هوية',
    });
    await tick();

    const before = await request(app)
      .get(notif('/syndicate-replies/unseen'))
      .set(bearer(member.accessToken));
    expect(before.status).toBe(200);
    expect(before.body.data).toEqual({ inquiries: 2, requests: 1, total: 3 });

    const seen = await request(app)
      .post(notif('/syndicate-replies/seen'))
      .set(bearer(member.accessToken))
      .send({ kind: 'INQUIRY' });
    expect(seen.status).toBe(200);
    expect(seen.body.data.updated).toBe(2);

    const after = await request(app)
      .get(notif('/syndicate-replies/unseen'))
      .set(bearer(member.accessToken));
    expect(after.body.data).toEqual({ inquiries: 0, requests: 1, total: 1 });

    // Clearing the tab also clears those notifications from the inbox count.
    const unread = await request(app).get(notif('/unread-count')).set(bearer(member.accessToken));
    expect(unread.body.data.count).toBe(1);
  });

  it('a pending submission is not counted, and another user sees zero', async () => {
    const { syndicate, officer, member } = await setup();
    await request(app)
      .post(api(`/${syndicate.id}/submissions`))
      .set(bearer(member.accessToken))
      .send({ kind: 'INQUIRY', message: 'لم يتم الرد بعد' });
    await submitAndRespond(syndicate.id, member.accessToken, officer.accessToken, {
      kind: 'INQUIRY',
      message: 'تم الرد',
    });
    await tick();

    const mine = await request(app)
      .get(notif('/syndicate-replies/unseen'))
      .set(bearer(member.accessToken));
    expect(mine.body.data.inquiries).toBe(1);

    const stranger = await registerUser(app);
    const theirs = await request(app)
      .get(notif('/syndicate-replies/unseen'))
      .set(bearer(stranger.accessToken));
    expect(theirs.body.data).toEqual({ inquiries: 0, requests: 0, total: 0 });

    const clearedByStranger = await request(app)
      .post(notif('/syndicate-replies/seen'))
      .set(bearer(stranger.accessToken))
      .send({ kind: 'INQUIRY' });
    expect(clearedByStranger.body.data.updated).toBe(0);
  });

  it('rejects an unknown kind and requires authentication', async () => {
    const { member } = await setup();
    const bad = await request(app)
      .post(notif('/syndicate-replies/seen'))
      .set(bearer(member.accessToken))
      .send({ kind: 'OTHER' });
    expect(bad.status).toBe(422);

    const anon = await request(app).get(notif('/syndicate-replies/unseen'));
    expect(anon.status).toBe(401);
  });
});
