import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { InMemoryObjectStorage } from '../../src/infra/storage/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createCategory,
  createTip,
  publishTip,
  registerAdmin,
  registerContentSupervisor,
  registerUser,
  seedPublishedTip,
  uploadTipCover,
} from '../helpers/factories.js';

const storage = new InMemoryObjectStorage(null);
const { app, container } = buildTestApp({ objectStorage: storage });

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  storage.clear();
});
afterAll(() => closeTestDb());

async function auditActions(entityId: string): Promise<string[]> {
  const rows = await getTestDb()('audit_logs')
    .where({ entity_id: entityId })
    .orderBy('created_at', 'asc')
    .select('action');
  return rows.map((r: { action: string }) => r.action);
}

// --- authoring & authorization ---------------------------------

describe('tips — authoring & authorization', () => {
  it('an admin creates a tip; it starts DRAFT with the given structure', async () => {
    const admin = await registerAdmin(app);
    const res = await createTip(app, admin.accessToken, {
      title: 'Summer feeding for sheep',
      summary: 'Balanced energy, water and minerals.',
      readMinutes: 5,
      priority: 'IMPORTANT',
      bodyIntro: 'In summer, sheep need a balanced diet…',
      keyPoints: ['Provide fibre-rich forage.', 'Feed early morning or evening.'],
      warningPoints: ['Loss of appetite.'],
      vetAdvice: 'Call a vet if symptoms persist over two days.',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'DRAFT',
      priority: 'IMPORTANT',
      isTipOfDay: false,
      readMinutes: 5,
      keyPoints: ['Provide fibre-rich forage.', 'Feed early morning or evening.'],
      warningPoints: ['Loss of appetite.'],
      helpfulCount: 0,
    });
    expect(await auditActions(res.body.data.id)).toEqual(['TIP_CREATED']);
  });

  it('an approved-vet CONTENT supervisor can create + publish tips', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerContentSupervisor(app, admin.accessToken);
    const created = await createTip(app, sup.accessToken, { title: 'Vitamins for lamb growth' });
    expect(created.status).toBe(201);
    expect((await publishTip(app, sup.accessToken, created.body.data.id)).status).toBe(200);
  });

  it('a normal user cannot manage tips (403)', async () => {
    const user = await registerUser(app);
    expect((await createTip(app, user.accessToken)).status).toBe(403);
    expect(
      (await request(app).get('/api/v1/admin/tips').set(bearer(user.accessToken))).status,
    ).toBe(403);
  });

  it('a CONTENT supervisor who is NOT an approved vet is rejected (403)', async () => {
    const admin = await registerAdmin(app);
    const plain = await registerUser(app);
    await request(app)
      .post('/api/v1/admin/supervisors')
      .set(bearer(admin.accessToken))
      .send({ userId: plain.id, domain: 'CONTENT' })
      .expect(201);
    expect((await createTip(app, plain.accessToken)).status).toBe(403);
  });

  it('soft-delete / restore are ADMIN-only (content.delete not in the CONTENT domain)', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerContentSupervisor(app, admin.accessToken);
    const id = (await createTip(app, sup.accessToken)).body.data.id as string;
    expect(
      (await request(app).delete(`/api/v1/admin/tips/${id}`).set(bearer(sup.accessToken))).status,
    ).toBe(403);
    expect(
      (await request(app).delete(`/api/v1/admin/tips/${id}`).set(bearer(admin.accessToken))).status,
    ).toBe(200);
  });

  it('rejects an unknown priority (422) and an unknown categoryId (400)', async () => {
    const admin = await registerAdmin(app);
    expect((await createTip(app, admin.accessToken, { priority: 'URGENT' })).status).toBe(422);
    expect(
      (
        await createTip(app, admin.accessToken, {
          categoryId: '00000000-0000-0000-0000-000000000000',
        })
      ).status,
    ).toBe(400);
  });
});

// --- lifecycle & public visibility -------------------------

describe('tips — lifecycle & public visibility', () => {
  it('only PUBLISHED, not-deleted tips are visible to users', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);

    const draftId = (await createTip(app, admin.accessToken, { title: 'Draft tip' })).body.data
      .id as string;
    const pubId = await seedPublishedTip(app, admin.accessToken, { title: 'Live tip' });

    const list = await request(app).get('/api/v1/tips').set(bearer(user.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.map((t: { id: string }) => t.id)).toEqual([pubId]);

    expect(
      (await request(app).get(`/api/v1/tips/${draftId}`).set(bearer(user.accessToken))).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/v1/tips/${pubId}`).set(bearer(user.accessToken))).status,
    ).toBe(200);
  });

  it('archiving a published tip removes it from the public list and clears tip-of-the-day', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const id = await seedPublishedTip(app, admin.accessToken);
    await request(app)
      .post(`/api/v1/admin/tips/${id}/tip-of-the-day`)
      .set(bearer(admin.accessToken))
      .send({ isTipOfDay: true })
      .expect(200);

    await request(app)
      .post(`/api/v1/admin/tips/${id}/archive`)
      .set(bearer(admin.accessToken))
      .expect(200);

    expect(
      (await request(app).get('/api/v1/tips').set(bearer(user.accessToken))).body.data,
    ).toEqual([]);
    expect(
      (await request(app).get('/api/v1/tips/tip-of-the-day').set(bearer(user.accessToken))).body
        .data,
    ).toBeNull();
  });

  it('filters by search, category and priority', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const catId = (
      await createCategory(app, admin.accessToken, { slug: 'nutrition', name: 'Nutrition' })
    ).body.data.id as string;

    await seedPublishedTip(app, admin.accessToken, {
      title: 'Summer feeding basics',
      priority: 'IMPORTANT',
      categoryId: catId,
    });
    await seedPublishedTip(app, admin.accessToken, {
      title: 'Calf diarrhoea response',
      priority: 'RECOMMENDED',
    });

    const bySearch = await request(app).get('/api/v1/tips?q=feeding').set(bearer(user.accessToken));
    expect(bySearch.body.data.map((t: { title: string }) => t.title)).toEqual([
      'Summer feeding basics',
    ]);
    const byCat = await request(app)
      .get(`/api/v1/tips?categoryId=${catId}`)
      .set(bearer(user.accessToken));
    expect(byCat.body.data).toHaveLength(1);
    const byPriority = await request(app)
      .get('/api/v1/tips?priority=RECOMMENDED')
      .set(bearer(user.accessToken));
    expect(byPriority.body.data.map((t: { title: string }) => t.title)).toEqual([
      'Calf diarrhoea response',
    ]);
  });
});

// --- tip of the day ---------------------------------------

describe('tips — tip of the day', () => {
  it('can only flag a PUBLISHED tip, and only one is ever set', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);

    const draftId = (await createTip(app, admin.accessToken, { title: 'Draft' })).body.data
      .id as string;
    expect(
      (
        await request(app)
          .post(`/api/v1/admin/tips/${draftId}/tip-of-the-day`)
          .set(bearer(admin.accessToken))
          .send({ isTipOfDay: true })
      ).status,
    ).toBe(400);

    const a = await seedPublishedTip(app, admin.accessToken, { title: 'Tip A' });
    const b = await seedPublishedTip(app, admin.accessToken, { title: 'Tip B' });
    await request(app)
      .post(`/api/v1/admin/tips/${a}/tip-of-the-day`)
      .set(bearer(admin.accessToken))
      .send({ isTipOfDay: true })
      .expect(200);
    await request(app)
      .post(`/api/v1/admin/tips/${b}/tip-of-the-day`)
      .set(bearer(admin.accessToken))
      .send({ isTipOfDay: true })
      .expect(200);

    const featured = await request(app)
      .get('/api/v1/tips/tip-of-the-day')
      .set(bearer(user.accessToken));
    expect(featured.body.data.id).toBe(b);
    const flagged = await getTestDb()('content_tips')
      .where({ is_tip_of_day: true })
      .count<{ count: string }>({ count: '*' })
      .first();
    expect(Number(flagged?.count)).toBe(1);
  });
});

// --- cover image ------------------------------------------

describe('tips — cover image', () => {
  it('registers a cover through the presigned R2 flow', async () => {
    const admin = await registerAdmin(app);
    const id = (await createTip(app, admin.accessToken)).body.data.id as string;
    const res = await uploadTipCover(app, container, admin.accessToken, id);
    expect(res.status).toBe(201);
    expect(res.body.data.coverImageUrl).toBeTruthy();
  });
});

// --- engagement (bookmark + helpful) --------------------

describe('tips — engagement', () => {
  it('bookmark toggle is idempotent and drives the ?bookmarked=true filter', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const id = await seedPublishedTip(app, admin.accessToken);

    await request(app)
      .post(`/api/v1/tips/${id}/bookmark`)
      .set(bearer(user.accessToken))
      .expect(200);
    await request(app)
      .post(`/api/v1/tips/${id}/bookmark`)
      .set(bearer(user.accessToken))
      .expect(200); // idempotent

    const mine = await request(app)
      .get('/api/v1/tips?bookmarked=true')
      .set(bearer(user.accessToken));
    expect(mine.body.data.map((t: { id: string }) => t.id)).toEqual([id]);
    expect(mine.body.data[0].isBookmarked).toBe(true);

    await request(app)
      .delete(`/api/v1/tips/${id}/bookmark`)
      .set(bearer(user.accessToken))
      .expect(200);
    expect(
      (await request(app).get('/api/v1/tips?bookmarked=true').set(bearer(user.accessToken))).body
        .data,
    ).toEqual([]);
  });

  it('helpful toggle keeps a per-user, de-duplicated helpfulCount', async () => {
    const admin = await registerAdmin(app);
    const u1 = await registerUser(app);
    const u2 = await registerUser(app);
    const id = await seedPublishedTip(app, admin.accessToken);

    const first = await request(app).post(`/api/v1/tips/${id}/helpful`).set(bearer(u1.accessToken));
    expect(first.body.data).toMatchObject({ isHelpful: true, helpfulCount: 1 });
    // same user again → no double count
    expect(
      (await request(app).post(`/api/v1/tips/${id}/helpful`).set(bearer(u1.accessToken))).body.data
        .helpfulCount,
    ).toBe(1);
    // a second user
    expect(
      (await request(app).post(`/api/v1/tips/${id}/helpful`).set(bearer(u2.accessToken))).body.data
        .helpfulCount,
    ).toBe(2);
    // u1 un-marks
    expect(
      (await request(app).delete(`/api/v1/tips/${id}/helpful`).set(bearer(u1.accessToken))).body
        .data.helpfulCount,
    ).toBe(1);

    const detail = await request(app).get(`/api/v1/tips/${id}`).set(bearer(u2.accessToken));
    expect(detail.body.data).toMatchObject({ helpfulCount: 1, isHelpful: true });
  });

  it('engagement on a non-visible tip is 404', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const draftId = (await createTip(app, admin.accessToken)).body.data.id as string;
    expect(
      (await request(app).post(`/api/v1/tips/${draftId}/bookmark`).set(bearer(user.accessToken)))
        .status,
    ).toBe(404);
  });
});
