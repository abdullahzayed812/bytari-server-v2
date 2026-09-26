import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  registerAdmin,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function setupOffice() {
  const admin = await registerAdmin(app);
  const owner = await registerUser(app);
  const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
    type: 'VETERINARY_OFFICE',
    name: 'Like Office',
  });
  return { admin, owner, office };
}

const engagement = async (orgId: string, token: string) =>
  (
    await request(app).get(`/api/v1/organizations/discover/${orgId}`).set(bearer(token))
  ).body.data.engagement as {
    isLiked: boolean;
    likesCount: number;
    isFollowing: boolean;
    followersCount: number;
    myReview: { rating: number; comment: string | null } | null;
  };

describe('likes — a real like count, independent of followers', () => {
  it('like / unlike increments and decrements likesCount; idempotent; followers unaffected', async () => {
    const { office } = await setupOffice();
    const a = await registerUser(app);
    const b = await registerUser(app);

    expect(
      (await request(app).post(`/api/v1/organizations/${office.id}/like`).set(bearer(a.accessToken)))
        .status,
    ).toBe(200);
    // double like is a no-op
    await request(app).post(`/api/v1/organizations/${office.id}/like`).set(bearer(a.accessToken));
    await request(app).post(`/api/v1/organizations/${office.id}/like`).set(bearer(b.accessToken));
    // b follows too — must not change likes
    await request(app).post(`/api/v1/organizations/${office.id}/follow`).set(bearer(b.accessToken));

    let e = await engagement(office.id, a.accessToken);
    expect(e).toMatchObject({ isLiked: true, likesCount: 2, followersCount: 1, isFollowing: false });

    await request(app).delete(`/api/v1/organizations/${office.id}/like`).set(bearer(a.accessToken));
    e = await engagement(office.id, a.accessToken);
    expect(e).toMatchObject({ isLiked: false, likesCount: 1, followersCount: 1 });
  });
});

describe('reviews — rules, own review, admin moderation', () => {
  it('one review per user (resubmit updates), exposed as myReview; deletable by its author', async () => {
    const { office } = await setupOffice();
    const u = await registerUser(app);
    await request(app)
      .post(`/api/v1/organizations/${office.id}/reviews`)
      .set(bearer(u.accessToken))
      .send({ rating: 2, comment: 'slow' });
    await request(app)
      .post(`/api/v1/organizations/${office.id}/reviews`)
      .set(bearer(u.accessToken))
      .send({ rating: 4, comment: 'better now' });

    const list = await request(app)
      .get(`/api/v1/organizations/${office.id}/reviews`)
      .set(bearer(u.accessToken));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ rating: 4, comment: 'better now' });

    expect((await engagement(office.id, u.accessToken)).myReview).toEqual({
      rating: 4,
      comment: 'better now',
    });
    const mine = await request(app)
      .get(`/api/v1/organizations/${office.id}/reviews/mine`)
      .set(bearer(u.accessToken));
    expect(mine.body.data.rating).toBe(4);

    expect(
      (
        await request(app)
          .delete(`/api/v1/organizations/${office.id}/reviews/mine`)
          .set(bearer(u.accessToken))
      ).status,
    ).toBe(200);
    expect((await engagement(office.id, u.accessToken)).myReview).toBeNull();
  });

  it('rejects out-of-range ratings (422) and members reviewing their own organization (403)', async () => {
    const { office, owner } = await setupOffice();
    const u = await registerUser(app);
    const bad = await request(app)
      .post(`/api/v1/organizations/${office.id}/reviews`)
      .set(bearer(u.accessToken))
      .send({ rating: 6 });
    expect(bad.status).toBe(422);

    const self = await request(app)
      .post(`/api/v1/organizations/${office.id}/reviews`)
      .set(bearer(owner.accessToken))
      .send({ rating: 5 });
    expect(self.status).toBe(403);
  });

  it('rejects reviews / likes on a non-reviewable organization type (FARM)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const farm = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'FARM',
      name: 'Farm',
    });
    const u = await registerUser(app);
    const res = await request(app)
      .post(`/api/v1/organizations/${farm.id}/reviews`)
      .set(bearer(u.accessToken))
      .send({ rating: 5 });
    expect(res.status).toBe(400);
    const like = await request(app)
      .post(`/api/v1/organizations/${farm.id}/like`)
      .set(bearer(u.accessToken));
    expect(like.status).toBe(400);
  });

  it('admin lists reviews with their organization and deletes one (audited); others cannot', async () => {
    const { office, admin } = await setupOffice();
    const u = await registerUser(app);
    await request(app)
      .post(`/api/v1/organizations/${office.id}/reviews`)
      .set(bearer(u.accessToken))
      .send({ rating: 1, comment: 'abusive text' });

    const list = await request(app)
      .get('/api/v1/admin/organizations/reviews?maxRating=2')
      .set(bearer(admin.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    const review = list.body.data[0] as {
      id: string;
      organization: { id: string; name: string; type: string };
    };
    expect(review.organization).toEqual({
      id: office.id,
      name: 'Like Office',
      type: 'VETERINARY_OFFICE',
    });

    const forbidden = await request(app)
      .delete(`/api/v1/admin/organizations/reviews/${review.id}`)
      .set(bearer(u.accessToken));
    expect(forbidden.status).toBe(403);
    const forbiddenList = await request(app)
      .get('/api/v1/admin/organizations/reviews')
      .set(bearer(u.accessToken));
    expect(forbiddenList.status).toBe(403);

    const del = await request(app)
      .delete(`/api/v1/admin/organizations/reviews/${review.id}`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'abuse' });
    expect(del.status).toBe(200);

    const after = await request(app)
      .get(`/api/v1/organizations/${office.id}/reviews`)
      .set(bearer(u.accessToken));
    expect(after.body.data).toHaveLength(0);

    const audit = await getTestDb()('audit_logs')
      .where({ action: 'ORGANIZATION_REVIEW_DELETED', entity_id: review.id })
      .first();
    expect(audit).toBeTruthy();

    const again = await request(app)
      .delete(`/api/v1/admin/organizations/reviews/${review.id}`)
      .set(bearer(admin.accessToken));
    expect(again.status).toBe(404);
  });
});
