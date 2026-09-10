import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createContent,
  publishContent,
  registerAdmin,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

/** Create + publish a MAGAZINE article (or BOOK, via `extra`) and return its id. */
async function seedPublished(
  actorToken: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const create = await createContent(app, actorToken, {
    type: 'MAGAZINE',
    title: 'Veterinary Magazine seed article',
    body: 'Body text.',
    ...extra,
  });
  expect(create.status).toBe(201);
  const id = create.body.data.id as string;
  const pub = await publishContent(app, actorToken, id);
  expect(pub.status).toBe(200);
  return id;
}

describe('content — book detail fields (language / pageCount / publishYear)', () => {
  it('round-trip through create, are visible on the public DTO, and can be updated', async () => {
    const admin = await registerAdmin(app);
    const create = await createContent(app, admin.accessToken, {
      type: 'BOOK',
      title: 'طب الحيوانات الداخلي',
      authorName: 'د. أحمد',
      language: 'العربية',
      pageCount: 560,
      publishYear: 2023,
    });
    expect(create.status).toBe(201);
    expect(create.body.data).toMatchObject({ language: 'العربية', pageCount: 560, publishYear: 2023 });
    const id = create.body.data.id as string;
    await publishContent(app, admin.accessToken, id);

    const user = await registerUser(app);
    const got = await request(app).get(`/api/v1/content/${id}`).set(bearer(user.accessToken));
    expect(got.body.data).toMatchObject({ language: 'العربية', pageCount: 560, publishYear: 2023 });

    const updated = await request(app)
      .patch(`/api/v1/admin/content/${id}`)
      .set(bearer(admin.accessToken))
      .send({ pageCount: 600 });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ pageCount: 600, language: 'العربية', publishYear: 2023 });
  });

  it('rejects an out-of-range publishYear / non-positive pageCount (422)', async () => {
    const admin = await registerAdmin(app);
    const bad1 = await createContent(app, admin.accessToken, {
      type: 'BOOK',
      title: 'x',
      publishYear: 1800,
    });
    expect(bad1.status).toBe(422);
    const bad2 = await createContent(app, admin.accessToken, {
      type: 'BOOK',
      title: 'x',
      pageCount: 0,
    });
    expect(bad2.status).toBe(422);
  });
});

describe('content — bookmarks', () => {
  it('toggle is idempotent and drives ?bookmarkedOnly=true', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const id = await seedPublished(admin.accessToken);

    await request(app).post(`/api/v1/content/${id}/bookmark`).set(bearer(user.accessToken)).expect(200);
    await request(app)
      .post(`/api/v1/content/${id}/bookmark`)
      .set(bearer(user.accessToken))
      .expect(200); // idempotent

    const mine = await request(app)
      .get('/api/v1/content?bookmarkedOnly=true')
      .set(bearer(user.accessToken));
    expect(mine.body.data.map((c: { id: string }) => c.id)).toEqual([id]);
    expect(mine.body.data[0].isBookmarked).toBe(true);

    // A stranger never bookmarked it — their own bookmarkedOnly list is empty.
    const stranger = await registerUser(app);
    const strangerMine = await request(app)
      .get('/api/v1/content?bookmarkedOnly=true')
      .set(bearer(stranger.accessToken));
    expect(strangerMine.body.data).toEqual([]);

    await request(app)
      .delete(`/api/v1/content/${id}/bookmark`)
      .set(bearer(user.accessToken))
      .expect(200);
    const cleared = await request(app)
      .get('/api/v1/content?bookmarkedOnly=true')
      .set(bearer(user.accessToken));
    expect(cleared.body.data).toEqual([]);
  });

  it('bookmarking a non-visible (DRAFT) content is 404', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const draft = await createContent(app, admin.accessToken, {
      type: 'MAGAZINE',
      title: 'still a draft',
    });
    const res = await request(app)
      .post(`/api/v1/content/${draft.body.data.id}/bookmark`)
      .set(bearer(user.accessToken));
    expect(res.status).toBe(404);
  });
});

describe('content — likes', () => {
  it('keeps a per-user, de-duplicated likeCount', async () => {
    const admin = await registerAdmin(app);
    const u1 = await registerUser(app);
    const u2 = await registerUser(app);
    const id = await seedPublished(admin.accessToken);

    const first = await request(app).post(`/api/v1/content/${id}/like`).set(bearer(u1.accessToken));
    expect(first.body.data).toMatchObject({ isLiked: true, likeCount: 1 });
    // same user again → no double count
    expect(
      (await request(app).post(`/api/v1/content/${id}/like`).set(bearer(u1.accessToken))).body.data
        .likeCount,
    ).toBe(1);
    // a second user
    expect(
      (await request(app).post(`/api/v1/content/${id}/like`).set(bearer(u2.accessToken))).body.data
        .likeCount,
    ).toBe(2);
    // u1 un-likes
    expect(
      (await request(app).delete(`/api/v1/content/${id}/like`).set(bearer(u1.accessToken))).body.data
        .likeCount,
    ).toBe(1);

    const detail = await request(app).get(`/api/v1/content/${id}`).set(bearer(u2.accessToken));
    expect(detail.body.data).toMatchObject({ likeCount: 1, isLiked: true });
  });
});

describe('content — comments', () => {
  it('creates, lists newest-first, and adjusts the denormalised commentCount', async () => {
    const admin = await registerAdmin(app);
    const u1 = await registerUser(app);
    const u2 = await registerUser(app);
    const id = await seedPublished(admin.accessToken);

    const c1 = await request(app)
      .post(`/api/v1/content/${id}/comments`)
      .set(bearer(u1.accessToken))
      .send({ body: 'التعليق الأول' });
    expect(c1.status).toBe(201);
    expect(c1.body.data).toMatchObject({ body: 'التعليق الأول', contentId: id, userId: u1.id });
    expect(c1.body.data.authorName.firstName).toBeTruthy();

    const c2 = await request(app)
      .post(`/api/v1/content/${id}/comments`)
      .set(bearer(u2.accessToken))
      .send({ body: 'التعليق الثاني' });
    expect(c2.status).toBe(201);

    const list = await request(app)
      .get(`/api/v1/content/${id}/comments`)
      .set(bearer(u1.accessToken));
    expect(list.body.data.map((c: { body: string }) => c.body)).toEqual([
      'التعليق الثاني',
      'التعليق الأول',
    ]);
    expect(list.body.meta.total).toBe(2);

    const detail = await request(app).get(`/api/v1/content/${id}`).set(bearer(u1.accessToken));
    expect(detail.body.data.commentCount).toBe(2);
  });

  it('rejects an empty comment (422); own comment can be deleted, another user’s cannot (403)', async () => {
    const admin = await registerAdmin(app);
    const u1 = await registerUser(app);
    const u2 = await registerUser(app);
    const id = await seedPublished(admin.accessToken);

    const empty = await request(app)
      .post(`/api/v1/content/${id}/comments`)
      .set(bearer(u1.accessToken))
      .send({ body: '' });
    expect(empty.status).toBe(422);

    const created = await request(app)
      .post(`/api/v1/content/${id}/comments`)
      .set(bearer(u1.accessToken))
      .send({ body: 'mine' });
    const commentId = created.body.data.id as string;

    const forbidden = await request(app)
      .delete(`/api/v1/content/${id}/comments/${commentId}`)
      .set(bearer(u2.accessToken));
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .delete(`/api/v1/content/${id}/comments/${commentId}`)
      .set(bearer(u1.accessToken));
    expect(ok.status).toBe(200);

    const detail = await request(app).get(`/api/v1/content/${id}`).set(bearer(u1.accessToken));
    expect(detail.body.data.commentCount).toBe(0);

    const list = await request(app)
      .get(`/api/v1/content/${id}/comments`)
      .set(bearer(u1.accessToken));
    expect(list.body.data).toEqual([]);
  });
});

describe('content — ratings (books)', () => {
  it('resubmitting upserts; the aggregate averages across users', async () => {
    const admin = await registerAdmin(app);
    const u1 = await registerUser(app);
    const u2 = await registerUser(app);
    const id = await seedPublished(admin.accessToken, { type: 'BOOK' });

    const r1 = await request(app)
      .put(`/api/v1/content/${id}/rating`)
      .set(bearer(u1.accessToken))
      .send({ rating: 4 });
    expect(r1.status).toBe(200);
    expect(r1.body.data).toEqual({ average: 4, count: 1 });

    const r2 = await request(app)
      .put(`/api/v1/content/${id}/rating`)
      .set(bearer(u2.accessToken))
      .send({ rating: 2 });
    expect(r2.body.data).toEqual({ average: 3, count: 2 });

    // u1 changes their mind — upsert, not a second row.
    const r1b = await request(app)
      .put(`/api/v1/content/${id}/rating`)
      .set(bearer(u1.accessToken))
      .send({ rating: 2 });
    expect(r1b.body.data).toEqual({ average: 2, count: 2 });

    const mine = await request(app).get(`/api/v1/content/${id}/rating`).set(bearer(u1.accessToken));
    expect(mine.body.data).toEqual({ aggregate: { average: 2, count: 2 }, myRating: 2 });

    const detail = await request(app).get(`/api/v1/content/${id}`).set(bearer(u1.accessToken));
    expect(detail.body.data.rating).toEqual({ average: 2, count: 2 });
  });

  it('rejects an out-of-range rating (422)', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const id = await seedPublished(admin.accessToken, { type: 'BOOK' });
    const res = await request(app)
      .put(`/api/v1/content/${id}/rating`)
      .set(bearer(user.accessToken))
      .send({ rating: 6 });
    expect(res.status).toBe(422);
  });

  it('a BOOK with no ratings yet reads back a null average / zero count', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const id = await seedPublished(admin.accessToken, { type: 'BOOK' });
    const detail = await request(app).get(`/api/v1/content/${id}`).set(bearer(user.accessToken));
    expect(detail.body.data.rating).toEqual({ average: null, count: 0 });
  });
});

describe('content — sort (latest / mostRead / topRated)', () => {
  it('mostRead orders by view count (each GET increments it)', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const popular = await seedPublished(admin.accessToken, { title: 'popular one' });
    const quiet = await seedPublished(admin.accessToken, { title: 'quiet one' });

    // Two views on `popular`, none on `quiet`.
    await request(app).get(`/api/v1/content/${popular}`).set(bearer(user.accessToken));
    await request(app).get(`/api/v1/content/${popular}`).set(bearer(user.accessToken));

    const sorted = await request(app)
      .get('/api/v1/content?sort=mostRead&type=MAGAZINE')
      .set(bearer(user.accessToken));
    const ids = sorted.body.data.map((c: { id: string }) => c.id);
    expect(ids.indexOf(popular)).toBeLessThan(ids.indexOf(quiet));

    const popularDetail = await request(app)
      .get(`/api/v1/content/${popular}`)
      .set(bearer(user.accessToken));
    expect(popularDetail.body.data.viewCount).toBeGreaterThanOrEqual(3); // 2 above + this one
  });

  it('topRated orders books by average rating', async () => {
    const admin = await registerAdmin(app);
    const rater = await registerUser(app);
    const user = await registerUser(app);
    const great = await seedPublished(admin.accessToken, { type: 'BOOK', title: 'great book' });
    const okay = await seedPublished(admin.accessToken, { type: 'BOOK', title: 'okay book' });

    await request(app)
      .put(`/api/v1/content/${great}/rating`)
      .set(bearer(rater.accessToken))
      .send({ rating: 5 });
    await request(app)
      .put(`/api/v1/content/${okay}/rating`)
      .set(bearer(rater.accessToken))
      .send({ rating: 2 });

    const sorted = await request(app)
      .get('/api/v1/content?sort=topRated&type=BOOK')
      .set(bearer(user.accessToken));
    const ids = sorted.body.data.map((c: { id: string }) => c.id);
    expect(ids.indexOf(great)).toBeLessThan(ids.indexOf(okay));
  });
});

describe('content — engagement audit trail', () => {
  it('bookmark / like / comment / rating actions write no audit rows (self-service, not audited)', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const id = await seedPublished(admin.accessToken);

    const before = await getTestDb()('audit_logs').where({ entity_id: id }).select('action');
    expect(before.map((r) => r.action)).toEqual(['CONTENT_CREATED', 'CONTENT_PUBLISHED']);

    await request(app).post(`/api/v1/content/${id}/bookmark`).set(bearer(user.accessToken));
    await request(app).post(`/api/v1/content/${id}/like`).set(bearer(user.accessToken));
    await request(app)
      .post(`/api/v1/content/${id}/comments`)
      .set(bearer(user.accessToken))
      .send({ body: 'hi' });
    await request(app)
      .put(`/api/v1/content/${id}/rating`)
      .set(bearer(user.accessToken))
      .send({ rating: 5 });

    const after = await getTestDb()('audit_logs').where({ entity_id: id }).select('action');
    expect(after.map((r) => r.action)).toEqual(['CONTENT_CREATED', 'CONTENT_PUBLISHED']);
  });
});
