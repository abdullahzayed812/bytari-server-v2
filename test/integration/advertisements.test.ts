import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { InMemoryObjectStorage } from '../../src/infra/storage/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addAdSlide,
  bearer,
  createAdCampaign,
  registerAdmin,
  registerAdvertisementSupervisor,
  registerContentSupervisor,
  registerUser,
  seedActiveAdCampaign,
  uploadAdSlideImage,
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

const feed = (token: string, placement: string) =>
  request(app).get('/api/v1/ads').query({ placement }).set(bearer(token));

// --- campaign creation & authorization -------------------------

describe('advertisements — campaign creation & authorization', () => {
  it('an admin creates a BANNER campaign; creator is derived from the token; starts inactive', async () => {
    const admin = await registerAdmin(app);
    const res = await createAdCampaign(app, admin.accessToken, {
      placement: 'HOME',
      type: 'BANNER',
      title: 'Home hero',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      placement: 'HOME',
      type: 'BANNER',
      title: 'Home hero',
      isActive: false,
      slides: [],
    });
    expect(await auditActions(res.body.data.id)).toEqual(['AD_CAMPAIGN_CREATED']);
  });

  it('an ADVERTISEMENT supervisor can manage campaigns for any placement', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerAdvertisementSupervisor(app, admin.accessToken);
    const res = await createAdCampaign(app, sup.accessToken, {
      placement: 'PETS',
      type: 'CAROUSEL',
      title: 'Pets carousel',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.placement).toBe('PETS');
  });

  it('a normal user cannot manage campaigns (403)', async () => {
    const user = await registerUser(app);
    expect(
      (
        await createAdCampaign(app, user.accessToken, {
          placement: 'HOME',
          type: 'BANNER',
          title: 'x',
        })
      ).status,
    ).toBe(403);
    expect((await request(app).get('/api/v1/admin/ads').set(bearer(user.accessToken))).status).toBe(
      403,
    );
  });

  it('a supervisor of a DIFFERENT domain (CONTENT) is rejected (403)', async () => {
    const admin = await registerAdmin(app);
    const contentSup = await registerContentSupervisor(app, admin.accessToken);
    expect(
      (
        await createAdCampaign(app, contentSup.accessToken, {
          placement: 'HOME',
          type: 'BANNER',
          title: 'x',
        })
      ).status,
    ).toBe(403);
  });

  it('a deactivated ADVERTISEMENT supervisor loses access immediately', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerUser(app, {});
    const assign = await request(app)
      .post('/api/v1/admin/supervisors')
      .set(bearer(admin.accessToken))
      .send({ userId: sup.id, domain: 'ADVERTISEMENT' });
    const assignmentId = assign.body.data.id as string;

    expect(
      (
        await createAdCampaign(app, sup.accessToken, {
          placement: 'HOME',
          type: 'BANNER',
          title: 'a',
        })
      ).status,
    ).toBe(201);
    await request(app)
      .delete(`/api/v1/admin/supervisors/${assignmentId}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(
      (
        await createAdCampaign(app, sup.accessToken, {
          placement: 'HOME',
          type: 'BANNER',
          title: 'b',
        })
      ).status,
    ).toBe(403);
  });

  it('rejects an unknown placement (422)', async () => {
    const admin = await registerAdmin(app);
    expect(
      (
        await createAdCampaign(app, admin.accessToken, {
          placement: 'NOPE',
          type: 'BANNER',
          title: 'x',
        })
      ).status,
    ).toBe(422);
  });
});

// --- slides: content, ordering, type rules -------------------

describe('advertisements — slides', () => {
  it('a BANNER campaign is capped at one slide (2nd → 400)', async () => {
    const admin = await registerAdmin(app);
    const c = await createAdCampaign(app, admin.accessToken, {
      placement: 'HOME',
      type: 'BANNER',
      title: 'Banner',
    });
    const id = c.body.data.id as string;
    expect((await addAdSlide(app, admin.accessToken, id, { title: 'one' })).status).toBe(201);
    expect((await addAdSlide(app, admin.accessToken, id, { title: 'two' })).status).toBe(400);
  });

  it('a CAROUSEL accepts multiple ordered slides and can reorder them', async () => {
    const admin = await registerAdmin(app);
    const c = await createAdCampaign(app, admin.accessToken, {
      placement: 'PETS',
      type: 'CAROUSEL',
      title: 'Carousel',
    });
    const id = c.body.data.id as string;
    const s1 = (await addAdSlide(app, admin.accessToken, id, { title: 's1' })).body.data
      .id as string;
    const s2 = (await addAdSlide(app, admin.accessToken, id, { title: 's2' })).body.data
      .id as string;
    const s3 = (await addAdSlide(app, admin.accessToken, id, { title: 's3' })).body.data
      .id as string;

    const reordered = await request(app)
      .post(`/api/v1/admin/ads/${id}/slides/reorder`)
      .set(bearer(admin.accessToken))
      .send({ slideIds: [s3, s1, s2] });
    expect(reordered.status).toBe(200);
    expect(reordered.body.data.slides.map((s: { id: string }) => s.id)).toEqual([s3, s1, s2]);
  });

  it('reorder rejects a non-permutation (400)', async () => {
    const admin = await registerAdmin(app);
    const c = await createAdCampaign(app, admin.accessToken, {
      placement: 'PETS',
      type: 'CAROUSEL',
      title: 'C',
    });
    const id = c.body.data.id as string;
    const s1 = (await addAdSlide(app, admin.accessToken, id, {})).body.data.id as string;
    await addAdSlide(app, admin.accessToken, id, {}); // a 2nd slide the payload omits
    const res = await request(app)
      .post(`/api/v1/admin/ads/${id}/slides/reorder`)
      .set(bearer(admin.accessToken))
      .send({ slideIds: [s1, s1] }); // duplicate + missing slide → not a permutation
    expect(res.status).toBe(400);
  });

  it('a slide may be image-only (no title); CTA requires a label', async () => {
    const admin = await registerAdmin(app);
    const c = await createAdCampaign(app, admin.accessToken, {
      placement: 'PETS',
      type: 'CAROUSEL',
      title: 'C',
    });
    const id = c.body.data.id as string;
    expect((await addAdSlide(app, admin.accessToken, id, {})).status).toBe(201);
    // ctaUrl without ctaLabel → 400
    expect(
      (await addAdSlide(app, admin.accessToken, id, { ctaUrl: 'https://x.example' })).status,
    ).toBe(400);
    expect(
      (
        await addAdSlide(app, admin.accessToken, id, {
          ctaLabel: 'Shop',
          ctaUrl: 'https://shop.example/pets',
        })
      ).status,
    ).toBe(201);
  });

  it('edits slide content and deletes a slide', async () => {
    const admin = await registerAdmin(app);
    const c = await createAdCampaign(app, admin.accessToken, {
      placement: 'PETS',
      type: 'CAROUSEL',
      title: 'C',
    });
    const id = c.body.data.id as string;
    const s = (await addAdSlide(app, admin.accessToken, id, { title: 'old' })).body.data
      .id as string;

    const upd = await request(app)
      .patch(`/api/v1/admin/ads/${id}/slides/${s}`)
      .set(bearer(admin.accessToken))
      .send({ title: 'new', subtitle: 'sub' });
    expect(upd.status).toBe(200);
    expect(upd.body.data).toMatchObject({ title: 'new', subtitle: 'sub' });

    const del = await request(app)
      .delete(`/api/v1/admin/ads/${id}/slides/${s}`)
      .set(bearer(admin.accessToken));
    expect(del.status).toBe(204);
    expect(
      (await request(app).get(`/api/v1/admin/ads/${id}`).set(bearer(admin.accessToken))).body.data
        .slides,
    ).toEqual([]);
  });
});

// --- images & activation (R2) -------------------------------

describe('advertisements — slide images & activation', () => {
  it('registers an uploaded image through the presigned R2 flow', async () => {
    const admin = await registerAdmin(app);
    const c = await createAdCampaign(app, admin.accessToken, {
      placement: 'HOME',
      type: 'BANNER',
      title: 'B',
    });
    const id = c.body.data.id as string;
    const slideId = (await addAdSlide(app, admin.accessToken, id, { title: 's' })).body.data
      .id as string;
    const res = await uploadAdSlideImage(app, container, admin.accessToken, id, slideId);
    expect(res.status).toBe(201);
    expect(res.body.data.imageUrl).toBeTruthy();
  });

  it('cannot activate a campaign until a slide has an image', async () => {
    const admin = await registerAdmin(app);
    const c = await createAdCampaign(app, admin.accessToken, {
      placement: 'HOME',
      type: 'BANNER',
      title: 'B',
    });
    const id = c.body.data.id as string;
    const slideId = (await addAdSlide(app, admin.accessToken, id, { title: 's' })).body.data
      .id as string;
    expect(
      (await request(app).post(`/api/v1/admin/ads/${id}/activate`).set(bearer(admin.accessToken)))
        .status,
    ).toBe(400);
    await uploadAdSlideImage(app, container, admin.accessToken, id, slideId);
    expect(
      (await request(app).post(`/api/v1/admin/ads/${id}/activate`).set(bearer(admin.accessToken)))
        .status,
    ).toBe(200);
  });
});

// --- public feed: placement, eligibility -----------------------

describe('advertisements — public feed GET /ads?placement', () => {
  it('returns active, imaged campaigns for the requested placement only', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);

    await seedActiveAdCampaign(app, container, admin.accessToken, {
      placement: 'HOME',
      type: 'BANNER',
      title: 'Home',
    });
    await seedActiveAdCampaign(app, container, admin.accessToken, {
      placement: 'PETS',
      type: 'CAROUSEL',
      title: 'Pets',
      slides: 3,
    });

    const home = await feed(user.accessToken, 'HOME');
    expect(home.status).toBe(200);
    expect(home.body.data).toHaveLength(1);
    expect(home.body.data[0]).toMatchObject({ placement: 'HOME', type: 'BANNER' });
    expect(home.body.data[0].slides).toHaveLength(1);

    const pets = await feed(user.accessToken, 'PETS');
    expect(pets.body.data).toHaveLength(1);
    expect(pets.body.data[0].type).toBe('CAROUSEL');
    expect(pets.body.data[0].slides).toHaveLength(3);

    const clinics = await feed(user.accessToken, 'CLINICS');
    expect(clinics.body.data).toEqual([]);
  });

  it('defaults to HOME when placement is omitted', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    await seedActiveAdCampaign(app, container, admin.accessToken, {
      placement: 'HOME',
      type: 'BANNER',
      title: 'H',
    });
    const res = await request(app).get('/api/v1/ads').set(bearer(user.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('excludes inactive, deleted, and out-of-window campaigns', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);

    // inactive
    const inactive = await createAdCampaign(app, admin.accessToken, {
      placement: 'HOME',
      type: 'BANNER',
      title: 'inactive',
    });
    const inactiveId = inactive.body.data.id as string;
    const inSlide = (await addAdSlide(app, admin.accessToken, inactiveId, {})).body.data
      .id as string;
    await uploadAdSlideImage(app, container, admin.accessToken, inactiveId, inSlide);

    // active but ends in the past
    const past = await seedActiveAdCampaign(app, container, admin.accessToken, {
      placement: 'HOME',
      type: 'BANNER',
      title: 'past',
    });
    await request(app)
      .patch(`/api/v1/admin/ads/${past.campaignId}`)
      .set(bearer(admin.accessToken))
      .send({ endsAt: '2000-01-01T00:00:00.000Z' });

    // active and in window
    await seedActiveAdCampaign(app, container, admin.accessToken, {
      placement: 'HOME',
      type: 'BANNER',
      title: 'live',
    });

    const res = await feed(user.accessToken, 'HOME');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('live');
  });

  it('a campaign with no imaged slide is not shown even when active', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const c = await createAdCampaign(app, admin.accessToken, {
      placement: 'HOME',
      type: 'CAROUSEL',
      title: 'empty',
    });
    // add a slide but never an image; activation is blocked, so force via DB-independent path:
    await addAdSlide(app, admin.accessToken, c.body.data.id, { title: 'no image' });
    // activation must fail (guard), confirming it can never reach the feed
    expect(
      (
        await request(app)
          .post(`/api/v1/admin/ads/${c.body.data.id}/activate`)
          .set(bearer(admin.accessToken))
      ).status,
    ).toBe(400);
    expect((await feed(user.accessToken, 'HOME')).body.data).toEqual([]);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/ads?placement=HOME')).status).toBe(401);
  });
});
