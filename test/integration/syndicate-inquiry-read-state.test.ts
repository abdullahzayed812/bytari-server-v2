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
  const other = await createSyndicate(app, admin.accessToken, { name: 'نقابة ب' });
  const officer = await registerApprovedVet(app);
  await assignOrganizationSupervisor(app, admin.accessToken, syndicate.id, {
    userId: officer.id,
    permissions: ['syndicate.submission.read', 'syndicate.submission.respond'],
  });
  const member = await registerUser(app);
  return { admin, syndicate, other, officer, member };
}

async function submit(syndicateId: string, token: string, message: string): Promise<string> {
  const res = await request(app)
    .post(api(`/${syndicateId}/submissions`))
    .set(bearer(token))
    .send({ kind: 'INQUIRY', message });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function respond(syndicateId: string, id: string, token: string): Promise<void> {
  const res = await request(app)
    .post(api(`/${syndicateId}/submissions/${id}/respond`))
    .set(bearer(token))
    .send({ responseText: 'تم الرد.' });
  expect(res.status).toBe(200);
}

const replies = async (token: string) =>
  (await request(app).get(notif('/syndicate-replies/unseen')).set(bearer(token))).body.data as {
    inquiries: number;
  };

const officerUnread = async (syndicateId: string, token: string): Promise<number> =>
  (
    await request(app)
      .get(api(`/${syndicateId}`))
      .set(bearer(token))
  ).body.data.counters.unreadInquiries as number;

describe('syndicate inquiry read state — submitter (new reply)', () => {
  it('flags unread replies in the list and clears exactly the ids marked, once', async () => {
    const { syndicate, officer, member } = await setup();
    const a = await submit(syndicate.id, member.accessToken, 'سؤال أ');
    const b = await submit(syndicate.id, member.accessToken, 'سؤال ب');
    await respond(syndicate.id, a, officer.accessToken);
    await respond(syndicate.id, b, officer.accessToken);
    await tick();
    expect((await replies(member.accessToken)).inquiries).toBe(2);

    const list = await request(app)
      .get(api('/submissions/mine?kind=INQUIRY'))
      .set(bearer(member.accessToken));
    const flags = new Map(
      (list.body.data as { id: string; isUnread: boolean }[]).map((s) => [s.id, s.isUnread]),
    );
    expect(flags.get(a)).toBe(true);
    expect(flags.get(b)).toBe(true);

    // Reading one inquiry leaves the other unread.
    const seen = await request(app)
      .post(api('/submissions/mine/seen'))
      .set(bearer(member.accessToken))
      .send({ submissionIds: [a] });
    expect(seen.status).toBe(200);
    expect(seen.body.data.submissionIds).toEqual([a]);
    await tick();
    expect((await replies(member.accessToken)).inquiries).toBe(1);

    // Viewing it again never double-counts or re-opens it.
    await request(app)
      .post(api('/submissions/mine/seen'))
      .set(bearer(member.accessToken))
      .send({ submissionIds: [a, a] });
    expect((await replies(member.accessToken)).inquiries).toBe(1);

    // Opening the specific inquiry clears its reply too.
    const one = await request(app)
      .get(api(`/submissions/mine/${b}`))
      .set(bearer(member.accessToken));
    expect(one.status).toBe(200);
    await tick();
    expect((await replies(member.accessToken)).inquiries).toBe(0);

    const unread = await request(app).get(notif('/unread-count')).set(bearer(member.accessToken));
    expect(unread.body.data.count).toBe(0);
  });

  it("ignores ids that are not the caller's own submissions", async () => {
    const { syndicate, officer, member } = await setup();
    const id = await submit(syndicate.id, member.accessToken, 'سؤال');
    await respond(syndicate.id, id, officer.accessToken);
    await tick();

    const stranger = await registerUser(app);
    const res = await request(app)
      .post(api('/submissions/mine/seen'))
      .set(bearer(stranger.accessToken))
      .send({ submissionIds: [id] });
    expect(res.status).toBe(200);
    expect(res.body.data.submissionIds).toEqual([]);
    expect((await replies(member.accessToken)).inquiries).toBe(1);
  });

  it('validates the body and requires authentication', async () => {
    const { member } = await setup();
    const empty = await request(app)
      .post(api('/submissions/mine/seen'))
      .set(bearer(member.accessToken))
      .send({ submissionIds: [] });
    expect(empty.status).toBe(422);
    const anon = await request(app).post(api('/submissions/mine/seen')).send({ submissionIds: [] });
    expect(anon.status).toBe(401);
  });
});

describe('syndicate inquiry read state — officer (new submission)', () => {
  it('opening the inquiries page clears only the rows shown, per officer', async () => {
    const { syndicate, officer, member } = await setup();
    const a = await submit(syndicate.id, member.accessToken, 'سؤال أ');
    const b = await submit(syndicate.id, member.accessToken, 'سؤال ب');
    await tick();
    expect(await officerUnread(syndicate.id, officer.accessToken)).toBe(2);

    const list = await request(app)
      .get(api(`/${syndicate.id}/submissions?kind=INQUIRY`))
      .set(bearer(officer.accessToken));
    expect(list.status).toBe(200);
    expect((list.body.data as { isUnread: boolean }[]).every((s) => s.isUnread)).toBe(true);

    const seen = await request(app)
      .post(api(`/${syndicate.id}/submissions/seen`))
      .set(bearer(officer.accessToken))
      .send({ submissionIds: [a] });
    expect(seen.status).toBe(200);
    await tick();
    expect(await officerUnread(syndicate.id, officer.accessToken)).toBe(1);

    await request(app)
      .post(api(`/${syndicate.id}/submissions/seen`))
      .set(bearer(officer.accessToken))
      .send({ submissionIds: [b] });
    await tick();
    expect(await officerUnread(syndicate.id, officer.accessToken)).toBe(0);

    // The submitter's own (reply) state is untouched by the officer reading.
    expect((await replies(member.accessToken)).inquiries).toBe(0);
  });

  it("is gated by syndicate.submission.read and scoped to that syndicate's ids", async () => {
    const { syndicate, other, officer, member } = await setup();
    const id = await submit(syndicate.id, member.accessToken, 'سؤال');
    await tick();

    const denied = await request(app)
      .post(api(`/${syndicate.id}/submissions/seen`))
      .set(bearer(member.accessToken))
      .send({ submissionIds: [id] });
    expect(denied.status).toBe(403);

    // An officer of another syndicate route can't clear this syndicate's ids.
    const admin2 = await registerAdmin(app);
    const crossed = await request(app)
      .post(api(`/${other.id}/submissions/seen`))
      .set(bearer(admin2.accessToken))
      .send({ submissionIds: [id] });
    expect(crossed.status).toBe(200);
    expect(crossed.body.data.submissionIds).toEqual([]);
    expect(await officerUnread(syndicate.id, officer.accessToken)).toBe(1);
  });
});
