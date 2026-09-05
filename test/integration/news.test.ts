import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  registerAdmin,
  registerContentSupervisor,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function createNews(token: string, body: Record<string, unknown> = {}): Promise<string> {
  const res = await request(app)
    .post('/api/v1/admin/news')
    .set(bearer(token))
    .send({ title: 'ارتفاع أسعار البيض', ...body });
  if (res.status !== 201) throw new Error(`createNews failed: ${res.status}`);
  return res.body.data.id as string;
}

async function publish(token: string, id: string): Promise<void> {
  await request(app).post(`/api/v1/admin/news/${id}/publish`).set(bearer(token)).expect(200);
}

describe('news — public reads', () => {
  it('lists only PUBLISHED news, featured first, with viewer bookmark state', async () => {
    const admin = await registerAdmin(app);
    const reader = await registerUser(app);

    const draftId = await createNews(admin.accessToken, { title: 'مسودة' });
    const plainId = await createNews(admin.accessToken, { title: 'خبر عادي' });
    const featuredId = await createNews(admin.accessToken, {
      title: 'خبر مميز',
      isFeatured: true,
      tag: 'URGENT',
      source: 'وزارة الزراعة',
    });
    await publish(admin.accessToken, plainId);
    await publish(admin.accessToken, featuredId);
    void draftId;

    const list = await request(app).get('/api/v1/news').set(bearer(reader.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.map((n: { id: string }) => n.id)).toEqual([featuredId, plainId]);
    expect(list.body.data[0]).toMatchObject({
      isFeatured: true,
      tag: 'URGENT',
      source: 'وزارة الزراعة',
      isBookmarked: false,
    });

    const detail = await request(app)
      .get(`/api/v1/news/${featuredId}`)
      .set(bearer(reader.accessToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.galleryUrls).toEqual([]);

    // a DRAFT id is a 404 for a public read
    const draft404 = await request(app)
      .get(`/api/v1/news/${draftId}`)
      .set(bearer(reader.accessToken));
    expect(draft404.status).toBe(404);
  });

  it('GET /news/featured returns the most recent featured item, or null', async () => {
    const admin = await registerAdmin(app);
    const reader = await registerUser(app);

    const none = await request(app).get('/api/v1/news/featured').set(bearer(reader.accessToken));
    expect(none.status).toBe(200);
    expect(none.body.data).toBeNull();

    const id = await createNews(admin.accessToken, { title: 'مميز', isFeatured: true });
    await publish(admin.accessToken, id);

    const got = await request(app).get('/api/v1/news/featured').set(bearer(reader.accessToken));
    expect(got.body.data.id).toBe(id);
  });

  it('bookmark toggle updates the per-user flag and the denormalised count', async () => {
    const admin = await registerAdmin(app);
    const reader = await registerUser(app);
    const id = await createNews(admin.accessToken);
    await publish(admin.accessToken, id);

    const on = await request(app)
      .post(`/api/v1/news/${id}/bookmark`)
      .set(bearer(reader.accessToken));
    expect(on.body.data).toEqual({ isBookmarked: true, bookmarkCount: 1 });

    const detail = await request(app).get(`/api/v1/news/${id}`).set(bearer(reader.accessToken));
    expect(detail.body.data).toMatchObject({ isBookmarked: true, bookmarkCount: 1 });

    const off = await request(app)
      .delete(`/api/v1/news/${id}/bookmark`)
      .set(bearer(reader.accessToken));
    expect(off.body.data).toEqual({ isBookmarked: false, bookmarkCount: 0 });
  });
});

describe('news — management authorization', () => {
  it('a plain user cannot create news (403); a CONTENT supervisor can', async () => {
    const admin = await registerAdmin(app);
    const stranger = await registerUser(app);
    const supervisor = await registerContentSupervisor(app, admin.accessToken);

    const denied = await request(app)
      .post('/api/v1/admin/news')
      .set(bearer(stranger.accessToken))
      .send({ title: 'x' });
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .post('/api/v1/admin/news')
      .set(bearer(supervisor.accessToken))
      .send({
        title: 'خبر من مشرف المحتوى',
        summary: 'ملخص',
        tag: 'IMPORTANT_ALERT',
        reasonPoints: ['سبب أول'],
        advicePoints: ['نصيحة أولى'],
      });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ status: 'DRAFT', tag: 'IMPORTANT_ALERT' });
  });

  it('publish → archive lifecycle + featured toggle', async () => {
    const admin = await registerAdmin(app);
    const id = await createNews(admin.accessToken);

    await publish(admin.accessToken, id);
    const feat = await request(app)
      .post(`/api/v1/admin/news/${id}/featured`)
      .set(bearer(admin.accessToken))
      .send({ isFeatured: true });
    expect(feat.body.data).toMatchObject({ isFeatured: true, status: 'PUBLISHED' });

    const arch = await request(app)
      .post(`/api/v1/admin/news/${id}/archive`)
      .set(bearer(admin.accessToken));
    expect(arch.body.data.status).toBe('ARCHIVED');

    // archived → invisible to a public read
    const reader = await registerUser(app);
    const gone = await request(app).get(`/api/v1/news/${id}`).set(bearer(reader.accessToken));
    expect(gone.status).toBe(404);
  });

  it('rejects an invalid tag (422)', async () => {
    const admin = await registerAdmin(app);
    const res = await request(app)
      .post('/api/v1/admin/news')
      .set(bearer(admin.accessToken))
      .send({ title: 'x', tag: 'BREAKING' });
    expect(res.status).toBe(422);
  });
});
