import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { bearer, createSyndicate, registerAdmin, registerUser } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const api = (p: string): string => `/api/v1/syndicates${p}`;
const base = { type: 'ANNOUNCEMENT', title: 'دورة جديدة', body: 'تفاصيل الدورة على الموقع' };

describe('Syndicate announcements — optional external link', () => {
  it('creates, shows, edits and clears an http(s) link', async () => {
    const admin = await registerAdmin(app);
    const syn = await createSyndicate(app, admin.accessToken);

    const created = await request(app)
      .post(api(`/${syn.id}/announcements`))
      .set(bearer(admin.accessToken))
      .send({ ...base, linkUrl: 'https://example.org/course?id=1' });
    expect(created.status).toBe(201);
    expect(created.body.data.linkUrl).toBe('https://example.org/course?id=1');
    const id = created.body.data.id as string;

    // Any signed-in viewer sees the link on the list and on the item.
    const viewer = await registerUser(app);
    const list = await request(app)
      .get(api(`/${syn.id}/announcements`))
      .set(bearer(viewer.accessToken))
      .expect(200);
    expect(list.body.data[0].linkUrl).toBe('https://example.org/course?id=1');

    const edited = await request(app)
      .patch(api(`/${syn.id}/announcements/${id}`))
      .set(bearer(admin.accessToken))
      .send({ linkUrl: 'http://example.org/other' })
      .expect(200);
    expect(edited.body.data.linkUrl).toBe('http://example.org/other');

    const cleared = await request(app)
      .patch(api(`/${syn.id}/announcements/${id}`))
      .set(bearer(admin.accessToken))
      .send({ linkUrl: '' })
      .expect(200);
    expect(cleared.body.data.linkUrl).toBeNull();

    // Without a link the field is simply null.
    const plain = await request(app)
      .post(api(`/${syn.id}/announcements`))
      .set(bearer(admin.accessToken))
      .send(base)
      .expect(201);
    expect(plain.body.data.linkUrl).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://example.org/file',
    'intent://scan/#Intent;scheme=zxing;end',
    'example.org',
    'https://',
  ])('rejects the unsafe / malformed link %s', async (linkUrl) => {
    const admin = await registerAdmin(app);
    const syn = await createSyndicate(app, admin.accessToken);
    const res = await request(app)
      .post(api(`/${syn.id}/announcements`))
      .set(bearer(admin.accessToken))
      .send({ ...base, linkUrl });
    expect(res.status).toBe(422);
  });

  it('the database refuses a non-http(s) link even if the API were bypassed', async () => {
    const admin = await registerAdmin(app);
    const syn = await createSyndicate(app, admin.accessToken);
    await expect(
      getTestDb()('syndicate_announcements').insert({
        organization_id: syn.id,
        title: 't',
        body: 'b',
        created_by_user_id: admin.id,
        link_url: 'javascript:alert(1)',
      }),
    ).rejects.toThrow(/chk_syndicate_announcements_link_url/);
  });

  it('a plain user still cannot publish (permissions unchanged)', async () => {
    const admin = await registerAdmin(app);
    const syn = await createSyndicate(app, admin.accessToken);
    const user = await registerUser(app);
    await request(app)
      .post(api(`/${syn.id}/announcements`))
      .set(bearer(user.accessToken))
      .send({ ...base, linkUrl: 'https://example.org' })
      .expect(403);
  });
});
