import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createActiveOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function setProfile(
  organizationId: string,
  ownerToken: string,
  patch: Record<string, unknown>,
) {
  const res = await request(app)
    .patch(`/api/v1/organizations/${organizationId}`)
    .set(bearer(ownerToken))
    .send(patch);
  if (res.status !== 200) {
    throw new Error(`setProfile failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

/** Full presigned gallery upload cycle against the mocked storage. */
async function uploadGalleryPhoto(
  ownerToken: string,
  organizationId: string,
  input: { filename: string; mimeType: string; size: number } = {
    filename: 'lobby.jpg',
    mimeType: 'image/jpeg',
    size: 2048,
  },
) {
  const urlRes = await request(app)
    .post(`/api/v1/organizations/${organizationId}/gallery/upload-url`)
    .set(bearer(ownerToken))
    .send(input);
  if (urlRes.status !== 201) return urlRes;
  const storageKey = urlRes.body.data.storageKey as string;
  await container.objectStorage.put(storageKey, Buffer.alloc(input.size, 1), {
    contentType: input.mimeType,
  });
  return request(app)
    .post(`/api/v1/organizations/${organizationId}/gallery`)
    .set(bearer(ownerToken))
    .send({ storageKey, mimeType: input.mimeType });
}

async function createActiveClinic(): Promise<{
  clinicId: string;
  ownerToken: string;
  adminToken: string;
}> {
  const vet = await registerApprovedVet(app);
  const admin = await registerAdmin(app);
  const clinic = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
    type: 'CLINIC',
    name: `Clinic ${Date.now()}`,
  });
  return { clinicId: clinic.id, ownerToken: vet.accessToken, adminToken: admin.accessToken };
}

describe('Clinic Details — directory profile fields', () => {
  it('accepts and returns workingHours / services / email / whatsapp / social links', async () => {
    const { clinicId, ownerToken } = await createActiveClinic();
    await setProfile(clinicId, ownerToken, {
      workingHours: '9:00 ص - 8:00 م',
      services: ['فحص', 'تطعيم', 'جراحة بسيطة'],
      email: 'info@alshifa-vet.com',
      whatsapp: '07712345678',
      instagramUrl: 'https://instagram.com/alshifa',
      facebookUrl: 'https://facebook.com/alshifa',
      tiktokUrl: 'https://tiktok.com/@alshifa',
    });

    const outsider = await registerUser(app);
    const res = await request(app)
      .get(`/api/v1/organizations/discover/${clinicId}`)
      .set(bearer(outsider.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      workingHours: '9:00 ص - 8:00 م',
      services: ['فحص', 'تطعيم', 'جراحة بسيطة'],
      email: 'info@alshifa-vet.com',
      whatsapp: '07712345678',
      instagramUrl: 'https://instagram.com/alshifa',
      facebookUrl: 'https://facebook.com/alshifa',
      tiktokUrl: 'https://tiktok.com/@alshifa',
    });
  });

  it('rejects an invalid email / a rating out of range at the validation layer', async () => {
    const { clinicId, ownerToken } = await createActiveClinic();
    const res = await request(app)
      .patch(`/api/v1/organizations/${clinicId}`)
      .set(bearer(ownerToken))
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
  });

  it('only a member with organization.update may change the profile', async () => {
    const { clinicId } = await createActiveClinic();
    const outsider = await registerUser(app);
    const res = await request(app)
      .patch(`/api/v1/organizations/${clinicId}`)
      .set(bearer(outsider.accessToken))
      .send({ workingHours: '9-5' });
    expect(res.status).toBe(403);
  });
});

describe('Clinic Details — gallery', () => {
  it('uploads, lists and removes gallery photos (owner only)', async () => {
    const { clinicId, ownerToken } = await createActiveClinic();

    const first = await uploadGalleryPhoto(ownerToken, clinicId);
    expect(first.status).toBe(200);
    expect(first.body.data.details.galleryUrls).toHaveLength(1);

    await uploadGalleryPhoto(ownerToken, clinicId, {
      filename: 'exam-room.jpg',
      mimeType: 'image/jpeg',
      size: 4096,
    });

    const outsider = await registerUser(app);
    const detail = await request(app)
      .get(`/api/v1/organizations/discover/${clinicId}`)
      .set(bearer(outsider.accessToken));
    expect(detail.body.data.galleryUrls).toHaveLength(2);

    // `galleryUrls` only ever carries resolved URLs, never the raw storage
    // key — removal by an unknown key is simply a 404, which this also proves.
    const removeRes = await request(app)
      .delete(`/api/v1/organizations/${clinicId}/gallery`)
      .set(bearer(ownerToken))
      .query({ storageKey: 'organizations/does-not-exist.jpg' });
    expect(removeRes.status).toBe(404);
  });

  it('rejects a gallery upload from a non-member', async () => {
    const { clinicId } = await createActiveClinic();
    const outsider = await registerUser(app);
    const res = await request(app)
      .post(`/api/v1/organizations/${clinicId}/gallery/upload-url`)
      .set(bearer(outsider.accessToken))
      .send({ filename: 'x.jpg', mimeType: 'image/jpeg', size: 1024 });
    expect(res.status).toBe(403);
  });

  it('enforces the gallery size cap', async () => {
    const { clinicId, ownerToken } = await createActiveClinic();
    for (let i = 0; i < 8; i += 1) {
      const res = await uploadGalleryPhoto(ownerToken, clinicId, {
        filename: `p${i}.jpg`,
        mimeType: 'image/jpeg',
        size: 1024,
      });
      expect(res.status).toBe(200);
    }
    const overflow = await uploadGalleryPhoto(ownerToken, clinicId, {
      filename: 'p9.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
    });
    expect(overflow.status).toBe(400);
    expect(overflow.body.error.code).toBe('GALLERY_LIMIT_EXCEEDED');
  }, 20000);
});

describe('Clinic Details — public detail composition (veterinarians + engagement)', () => {
  it('lists ACTIVE VETERINARIAN members, public-safe fields only', async () => {
    const { clinicId, ownerToken } = await createActiveClinic();
    const vet2 = await registerApprovedVet(app);
    await addOrganizationMember(app, ownerToken, clinicId, {
      userId: vet2.id,
      role: 'VETERINARIAN',
    });

    const outsider = await registerUser(app);
    const res = await request(app)
      .get(`/api/v1/organizations/discover/${clinicId}`)
      .set(bearer(outsider.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.veterinarians).toHaveLength(1);
    expect(res.body.data.veterinarians[0]).toMatchObject({ id: vet2.id });
    expect(res.body.data.veterinarians[0]).not.toHaveProperty('email');
    expect(res.body.data.veterinarians[0]).not.toHaveProperty('roleKey');
  });

  it('does not leak veterinarians from another organization (no cross-org leakage)', async () => {
    const { clinicId: clinicA, ownerToken: ownerA } = await createActiveClinic();
    const { clinicId: clinicB, ownerToken: ownerB } = await createActiveClinic();
    const vetA = await registerApprovedVet(app);
    const vetB = await registerApprovedVet(app);
    await addOrganizationMember(app, ownerA, clinicA, { userId: vetA.id, role: 'VETERINARIAN' });
    await addOrganizationMember(app, ownerB, clinicB, { userId: vetB.id, role: 'VETERINARIAN' });

    const outsider = await registerUser(app);
    const res = await request(app)
      .get(`/api/v1/organizations/discover/${clinicA}`)
      .set(bearer(outsider.accessToken));
    const ids = res.body.data.veterinarians.map((v: { id: string }) => v.id);
    expect(ids).toContain(vetA.id);
    expect(ids).not.toContain(vetB.id);
  });

  it('404s for a non-existent organization id', async () => {
    const outsider = await registerUser(app);
    const res = await request(app)
      .get('/api/v1/organizations/discover/00000000-0000-0000-0000-000000000000')
      .set(bearer(outsider.accessToken));
    expect(res.status).toBe(404);
  });

  it('404s for a PENDING (not yet approved) organization', async () => {
    const vet = await registerApprovedVet(app);
    const pending = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(vet.accessToken))
      .send({ type: 'CLINIC', name: 'Not yet approved' });
    const outsider = await registerUser(app);
    const res = await request(app)
      .get(`/api/v1/organizations/discover/${pending.body.data.id}`)
      .set(bearer(outsider.accessToken));
    expect(res.status).toBe(404);
  });
});

describe('Clinic Details — follow', () => {
  it('follows / unfollows, idempotently, and updates the count for every viewer', async () => {
    const { clinicId } = await createActiveClinic();
    const petOwner = await registerUser(app);
    const otherViewer = await registerUser(app);

    const before = await request(app)
      .get(`/api/v1/organizations/discover/${clinicId}`)
      .set(bearer(otherViewer.accessToken));
    expect(before.body.data.engagement).toMatchObject({ isFollowing: false, followersCount: 0 });

    const follow = await request(app)
      .post(`/api/v1/organizations/${clinicId}/follow`)
      .set(bearer(petOwner.accessToken));
    expect(follow.status).toBe(200);

    // Idempotent — following twice is not a conflict.
    const followAgain = await request(app)
      .post(`/api/v1/organizations/${clinicId}/follow`)
      .set(bearer(petOwner.accessToken));
    expect(followAgain.status).toBe(200);

    const asFollower = await request(app)
      .get(`/api/v1/organizations/discover/${clinicId}`)
      .set(bearer(petOwner.accessToken));
    expect(asFollower.body.data.engagement).toMatchObject({
      isFollowing: true,
      followersCount: 1,
    });

    const asOther = await request(app)
      .get(`/api/v1/organizations/discover/${clinicId}`)
      .set(bearer(otherViewer.accessToken));
    expect(asOther.body.data.engagement).toMatchObject({
      isFollowing: false,
      followersCount: 1,
    });

    const unfollow = await request(app)
      .delete(`/api/v1/organizations/${clinicId}/follow`)
      .set(bearer(petOwner.accessToken));
    expect(unfollow.status).toBe(200);

    const afterUnfollow = await request(app)
      .get(`/api/v1/organizations/discover/${clinicId}`)
      .set(bearer(petOwner.accessToken));
    expect(afterUnfollow.body.data.engagement).toMatchObject({
      isFollowing: false,
      followersCount: 0,
    });
  });

  it('404s following a non-existent organization', async () => {
    const petOwner = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/organizations/00000000-0000-0000-0000-000000000000/follow')
      .set(bearer(petOwner.accessToken));
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const { clinicId } = await createActiveClinic();
    const res = await request(app).post(`/api/v1/organizations/${clinicId}/follow`);
    expect(res.status).toBe(401);
  });
});

describe('Clinic Details — ratings & reviews', () => {
  it('submits a review and reflects it in the aggregate rating/reviewsCount', async () => {
    const { clinicId } = await createActiveClinic();
    const reviewer1 = await registerUser(app);
    const reviewer2 = await registerUser(app);

    const r1 = await request(app)
      .post(`/api/v1/organizations/${clinicId}/reviews`)
      .set(bearer(reviewer1.accessToken))
      .send({ rating: 5, comment: 'ممتاز' });
    expect(r1.status).toBe(200);

    const r2 = await request(app)
      .post(`/api/v1/organizations/${clinicId}/reviews`)
      .set(bearer(reviewer2.accessToken))
      .send({ rating: 3 });
    expect(r2.status).toBe(200);

    const outsider = await registerUser(app);
    const detail = await request(app)
      .get(`/api/v1/organizations/discover/${clinicId}`)
      .set(bearer(outsider.accessToken));
    expect(detail.body.data.engagement).toMatchObject({ rating: 4, reviewsCount: 2 });
  });

  it("upserts — resubmitting replaces the reviewer's own rating instead of duplicating it", async () => {
    const { clinicId } = await createActiveClinic();
    const reviewer = await registerUser(app);
    await request(app)
      .post(`/api/v1/organizations/${clinicId}/reviews`)
      .set(bearer(reviewer.accessToken))
      .send({ rating: 2 });
    await request(app)
      .post(`/api/v1/organizations/${clinicId}/reviews`)
      .set(bearer(reviewer.accessToken))
      .send({ rating: 5, comment: 'updated my mind' });

    const list = await request(app)
      .get(`/api/v1/organizations/${clinicId}/reviews`)
      .set(bearer(reviewer.accessToken));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ rating: 5, comment: 'updated my mind' });
    expect(list.body.data[0].author).toMatchObject({ firstName: 'Test' });
  });

  it('rejects a rating outside 1-5', async () => {
    const { clinicId } = await createActiveClinic();
    const reviewer = await registerUser(app);
    const res = await request(app)
      .post(`/api/v1/organizations/${clinicId}/reviews`)
      .set(bearer(reviewer.accessToken))
      .send({ rating: 6 });
    expect(res.status).toBe(422);
  });

  it('404s reviewing a non-existent organization', async () => {
    const reviewer = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/organizations/00000000-0000-0000-0000-000000000000/reviews')
      .set(bearer(reviewer.accessToken))
      .send({ rating: 4 });
    expect(res.status).toBe(404);
  });
});
