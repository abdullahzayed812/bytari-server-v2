import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  approvePublication,
  bearer,
  createAnimal,
  createAnimalPublication,
  createPublicationInteraction,
  registerAdmin,
  registerUser,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

/** Full presigned gallery upload cycle against the mocked storage. */
async function uploadAnimalPhoto(
  ownerToken: string,
  animalId: string,
  input: { filename: string; mimeType: string; size: number } = {
    filename: 'animal.jpg',
    mimeType: 'image/jpeg',
    size: 2048,
  },
) {
  const urlRes = await request(app)
    .post(`/api/v1/animals/${animalId}/gallery/upload-url`)
    .set(bearer(ownerToken))
    .send(input);
  if (urlRes.status !== 201) return urlRes;
  const storageKey = urlRes.body.data.storageKey as string;
  await container.objectStorage.put(storageKey, Buffer.alloc(input.size, 1), {
    contentType: input.mimeType,
  });
  return request(app)
    .post(`/api/v1/animals/${animalId}/gallery`)
    .set(bearer(ownerToken))
    .send({ storageKey, mimeType: input.mimeType });
}

describe('Animal gallery — presigned upload / finalize / remove', () => {
  it('uploads, lists (via the animal read + the public listing join) and removes gallery photos', async () => {
    const owner = await registerUser(app);
    const admin = await registerAdmin(app);
    const animal = await createAnimal(app, owner.accessToken);

    const first = await uploadAnimalPhoto(owner.accessToken, animal.id);
    expect(first.status).toBe(200);
    expect(first.body.data.galleryUrls).toHaveLength(1);

    await uploadAnimalPhoto(owner.accessToken, animal.id, {
      filename: 'second.jpg',
      mimeType: 'image/jpeg',
      size: 4096,
    });
    const getAnimal = await request(app)
      .get(`/api/v1/animals/${animal.id}`)
      .set(bearer(owner.accessToken));
    expect(getAnimal.body.data.galleryUrls).toHaveLength(2);

    // Gallery photos flow through to the public publication projection too.
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, {
      kind: 'ADOPTION',
    });
    await approvePublication(app, admin.accessToken, pub.id);
    const publicView = await request(app)
      .get(`/api/v1/animal-publications/${pub.id}`)
      .set(bearer((await registerUser(app)).accessToken));
    expect(publicView.body.data.animal.galleryUrls).toHaveLength(2);

    const removeRes = await request(app)
      .delete(`/api/v1/animals/${animal.id}/gallery`)
      .set(bearer(owner.accessToken))
      .query({ storageKey: 'animals/does-not-exist.jpg' });
    expect(removeRes.status).toBe(404);
  });

  it('rejects a gallery upload from a non-owner', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const res = await request(app)
      .post(`/api/v1/animals/${animal.id}/gallery/upload-url`)
      .set(bearer(stranger.accessToken))
      .send({ filename: 'x.jpg', mimeType: 'image/jpeg', size: 1024 });
    expect(res.status).toBe(404);
  });

  it('enforces the 8-photo gallery cap', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    for (let i = 0; i < 8; i += 1) {
      const res = await uploadAnimalPhoto(owner.accessToken, animal.id, {
        filename: `p${i}.jpg`,
        mimeType: 'image/jpeg',
        size: 1024,
      });
      expect(res.status).toBe(200);
    }
    const overflow = await uploadAnimalPhoto(owner.accessToken, animal.id, {
      filename: 'p9.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
    });
    expect(overflow.status).toBe(400);
    expect(overflow.body.error.code).toBe('GALLERY_LIMIT_EXCEEDED');
  }, 20000);
});

describe('Publication interactions — "طلب التبني" / "طلب تزاوج" / "ابلاغ عن مشاهدة"', () => {
  async function approvedPublication(kind: 'LOST' | 'ADOPTION' | 'MATING') {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, { kind });
    await approvePublication(app, admin.accessToken, pub.id);
    return { owner, pub };
  }

  it('a stranger requests adoption on an APPROVED listing (201)', async () => {
    const { pub } = await approvedPublication('ADOPTION');
    const requester = await registerUser(app);
    const res = await createPublicationInteraction(app, requester.accessToken, pub.id, {
      type: 'REQUEST',
      message: 'أريد التبني',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      publicationId: pub.id,
      type: 'REQUEST',
      requesterUserId: requester.id,
    });
  });

  it('re-tapping the same interaction upserts (no duplicate rows)', async () => {
    const { pub } = await approvedPublication('LOST');
    const requester = await registerUser(app);
    const first = await createPublicationInteraction(app, requester.accessToken, pub.id, {
      type: 'SIGHTING',
      message: 'شاهدته قرب السوق',
    });
    const second = await createPublicationInteraction(app, requester.accessToken, pub.id, {
      type: 'SIGHTING',
      message: 'شاهدته مرة أخرى قرب الحديقة',
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.message).toBe('شاهدته مرة أخرى قرب الحديقة');
  });

  it("the listing's own owner cannot interact with their own listing (403)", async () => {
    const { owner, pub } = await approvedPublication('MATING');
    const res = await createPublicationInteraction(app, owner.accessToken, pub.id, {
      type: 'REQUEST',
    });
    expect(res.status).toBe(403);
  });

  it('a PENDING (not yet approved) publication rejects interactions (404 — no ID-probing leak)', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, { kind: 'LOST' });
    const stranger = await registerUser(app);
    const res = await createPublicationInteraction(app, stranger.accessToken, pub.id, {
      type: 'SIGHTING',
    });
    expect(res.status).toBe(404);
  });

  it('a REJECTED publication rejects interactions (404)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, {
      kind: 'ADOPTION',
    });
    await request(app)
      .post(`/api/v1/admin/animal-publications/${pub.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'blurry photos' });
    const stranger = await registerUser(app);
    const res = await createPublicationInteraction(app, stranger.accessToken, pub.id, {
      type: 'REQUEST',
    });
    expect(res.status).toBe(404);
  });

  it('rejects an invalid interaction type (422)', async () => {
    const { pub } = await approvedPublication('ADOPTION');
    const requester = await registerUser(app);
    const res = await createPublicationInteraction(app, requester.accessToken, pub.id, {
      // @ts-expect-error deliberately invalid for the test
      type: 'CHAT',
    });
    expect(res.status).toBe(422);
  });
});

describe('BUSINESS RULE — moderation & public-visibility invariants (Adoption / Lost / Mating)', () => {
  it('public listings return APPROVED publications from ALL users, never scoped to the caller', async () => {
    const admin = await registerAdmin(app);
    const ownerA = await registerUser(app);
    const ownerB = await registerUser(app);
    const animalA = await createAnimal(app, ownerA.accessToken);
    const animalB = await createAnimal(app, ownerB.accessToken);
    const pubA = await createAnimalPublication(app, ownerA.accessToken, animalA.id, {
      kind: 'ADOPTION',
    });
    const pubB = await createAnimalPublication(app, ownerB.accessToken, animalB.id, {
      kind: 'ADOPTION',
    });
    await approvePublication(app, admin.accessToken, pubA.id);
    await approvePublication(app, admin.accessToken, pubB.id);

    // A neutral third party — not the creator of either listing — sees both.
    const viewer = await registerUser(app);
    const res = await request(app)
      .get('/api/v1/animal-publications?kind=ADOPTION')
      .set(bearer(viewer.accessToken));
    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([pubA.id, pubB.id]));
  });

  it('a newly created listing starts PENDING and never appears in the public list', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, { kind: 'LOST' });
    expect(pub.status).toBe('PENDING');

    const anyone = await registerUser(app);
    const res = await request(app)
      .get('/api/v1/animal-publications?kind=LOST')
      .set(bearer(anyone.accessToken));
    expect((res.body.data as Array<{ id: string }>).map((p) => p.id)).not.toContain(pub.id);
  });

  it('a REJECTED listing never appears in the public list or the public detail, even by its own creator', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, {
      kind: 'MATING',
    });
    await request(app)
      .post(`/api/v1/admin/animal-publications/${pub.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'incomplete details' });

    const list = await request(app)
      .get('/api/v1/animal-publications?kind=MATING')
      .set(bearer(owner.accessToken));
    expect((list.body.data as Array<{ id: string }>).map((p) => p.id)).not.toContain(pub.id);

    // the creator cannot fetch their own rejected listing via the PUBLIC detail endpoint either
    const detail = await request(app)
      .get(`/api/v1/animal-publications/${pub.id}`)
      .set(bearer(owner.accessToken));
    expect(detail.status).toBe(404);
  });

  it('a PENDING listing cannot be fetched via the public detail endpoint by ID, including by its own creator', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, {
      kind: 'ADOPTION',
    });
    const byOwner = await request(app)
      .get(`/api/v1/animal-publications/${pub.id}`)
      .set(bearer(owner.accessToken));
    expect(byOwner.status).toBe(404);

    const byStranger = await request(app)
      .get(`/api/v1/animal-publications/${pub.id}`)
      .set(bearer((await registerUser(app)).accessToken));
    expect(byStranger.status).toBe(404);
  });

  it("the creator can still see their own PENDING / REJECTED listings via the owner-scoped 'my listings' endpoint", async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const pendingPub = await createAnimalPublication(app, owner.accessToken, animal.id, {
      kind: 'LOST',
    });

    const animal2 = await createAnimal(app, owner.accessToken);
    const rejectedPub = await createAnimalPublication(app, owner.accessToken, animal2.id, {
      kind: 'ADOPTION',
    });
    await request(app)
      .post(`/api/v1/admin/animal-publications/${rejectedPub.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'x' });

    const own = await request(app)
      .get(`/api/v1/animals/${animal.id}/publications`)
      .set(bearer(owner.accessToken));
    expect(own.status).toBe(200);
    expect(own.body.data.map((p: { id: string }) => p.id)).toContain(pendingPub.id);

    const own2 = await request(app)
      .get(`/api/v1/animals/${animal2.id}/publications`)
      .set(bearer(owner.accessToken));
    expect(own2.body.data.map((p: { id: string }) => p.id)).toContain(rejectedPub.id);
    expect(own2.body.data[0].status).toBe('REJECTED');
  });

  it('only an authorized ADMIN/supervisor can approve or reject — a plain user cannot', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, { kind: 'LOST' });

    const approve = await request(app)
      .post(`/api/v1/admin/animal-publications/${pub.id}/approve`)
      .set(bearer(stranger.accessToken));
    expect(approve.status).toBe(403);

    const reject = await request(app)
      .post(`/api/v1/admin/animal-publications/${pub.id}/reject`)
      .set(bearer(stranger.accessToken))
      .send({ reason: 'x' });
    expect(reject.status).toBe(403);

    // still PENDING — neither call took effect
    const own = await request(app)
      .get(`/api/v1/animals/${animal.id}/publications`)
      .set(bearer(owner.accessToken));
    expect(own.body.data[0].status).toBe('PENDING');
  });
});
