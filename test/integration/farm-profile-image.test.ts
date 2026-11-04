import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createFarm,
  createOrganization,
  setFarmSubscriptionAsAdmin,
  fixtureBytes,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function uploadFarmPhoto(token: string, organizationId: string): Promise<string> {
  const input = { filename: 'farm.jpg', mimeType: 'image/jpeg', size: 4096 };
  const urlRes = await request(app)
    .post(`/api/v1/organizations/${organizationId}/farm/profile/image/upload-url`)
    .set(bearer(token))
    .send(input);
  expect(urlRes.status).toBe(200);
  const storageKey = urlRes.body.data.storageKey as string;
  await container.objectStorage.put(storageKey, fixtureBytes(input.mimeType, input.size), {
    contentType: input.mimeType,
  });
  const done = await request(app)
    .post(`/api/v1/organizations/${organizationId}/farm/profile/image`)
    .set(bearer(token))
    .send({ storageKey, mimeType: input.mimeType });
  expect(done.status).toBe(200);
  expect(typeof done.body.data.imageUrl).toBe('string');
  return storageKey;
}

async function farmImageKey(organizationId: string): Promise<string | null> {
  const row = (await container
    .db('farm_details')
    .where({ organization_id: organizationId })
    .first('image_key')) as { image_key: string | null } | undefined;
  return row?.image_key ?? null;
}

describe('farm profile image — replace / delete from the Edit Farm screen', () => {
  async function setup() {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken, { name: 'Img Farm' });
    return { owner, farm };
  }

  it('the farm list (card source) exposes the uploaded photo as imageUrl', async () => {
    const { owner, farm } = await setup();
    await uploadFarmPhoto(owner.accessToken, farm.id);
    const res = await request(app)
      .get('/api/v1/organizations?scope=farm_section')
      .set(bearer(owner.accessToken));
    expect(res.status).toBe(200);
    const row = (res.body.data as Array<{ id: string; imageUrl?: string | null }>).find(
      (o) => o.id === farm.id,
    );
    expect(typeof row?.imageUrl).toBe('string');
  });

  it('replacing the photo points the row at the new key and deletes the old object', async () => {
    const { owner, farm } = await setup();
    const first = await uploadFarmPhoto(owner.accessToken, farm.id);
    const second = await uploadFarmPhoto(owner.accessToken, farm.id);
    expect(second).not.toBe(first);
    expect(await farmImageKey(farm.id)).toBe(second);
    expect(await container.objectStorage.head(first)).toBeNull();
    expect(await container.objectStorage.head(second)).not.toBeNull();
  });

  it('DELETE clears the reference and the stored object', async () => {
    const { owner, farm } = await setup();
    const key = await uploadFarmPhoto(owner.accessToken, farm.id);
    const res = await request(app)
      .delete(`/api/v1/organizations/${farm.id}/farm/profile/image`)
      .set(bearer(owner.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.imageUrl).toBeNull();
    expect(await farmImageKey(farm.id)).toBeNull();
    expect(await container.objectStorage.head(key)).toBeNull();

    // idempotent: no photo → still 200
    const again = await request(app)
      .delete(`/api/v1/organizations/${farm.id}/farm/profile/image`)
      .set(bearer(owner.accessToken));
    expect(again.status).toBe(200);
  });

  it('a storage failure rolls the reference back (503) — nothing orphaned', async () => {
    const { owner, farm } = await setup();
    const key = await uploadFarmPhoto(owner.accessToken, farm.id);
    const spy = vi
      .spyOn(container.objectStorage, 'delete')
      .mockRejectedValueOnce(new Error('r2 down'));
    try {
      const res = await request(app)
        .delete(`/api/v1/organizations/${farm.id}/farm/profile/image`)
        .set(bearer(owner.accessToken));
      expect(res.status).toBe(503);
    } finally {
      spy.mockRestore();
    }
    expect(await farmImageKey(farm.id)).toBe(key);
    expect(await container.objectStorage.head(key)).not.toBeNull();
  });

  it('a non-member cannot delete the photo', async () => {
    const { owner, farm } = await setup();
    await uploadFarmPhoto(owner.accessToken, farm.id);
    const stranger = await registerUser(app);
    const res = await request(app)
      .delete(`/api/v1/organizations/${farm.id}/farm/profile/image`)
      .set(bearer(stranger.accessToken));
    expect([403, 404]).toContain(res.status);
    expect(await farmImageKey(farm.id)).not.toBeNull();
  });
});

describe('farm profile image — right after creation (PENDING farm, no subscription)', () => {
  it('the owner can upload the photo picked on the "Add farm" form', async () => {
    const owner = await registerApprovedVet(app);
    const org = await createOrganization(app, owner.accessToken, { type: 'FARM', name: 'New' });
    expect(org.status).toBe('PENDING');
    const key = await uploadFarmPhoto(owner.accessToken, org.id);
    expect(await farmImageKey(org.id)).toBe(key);

    const profile = await request(app)
      .get(`/api/v1/organizations/${org.id}/farm/profile`)
      .set(bearer(owner.accessToken));
    expect(profile.status).toBe(200);
    expect(typeof profile.body.data.imageUrl).toBe('string');

    const del = await request(app)
      .delete(`/api/v1/organizations/${org.id}/farm/profile/image`)
      .set(bearer(owner.accessToken));
    expect(del.status).toBe(200);
    expect(await farmImageKey(org.id)).toBeNull();
  });

  it('a non-owner still cannot upload to a PENDING farm', async () => {
    const owner = await registerApprovedVet(app);
    const org = await createOrganization(app, owner.accessToken, { type: 'FARM', name: 'New' });
    const stranger = await registerApprovedVet(app);
    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/farm/profile/image/upload-url`)
      .set(bearer(stranger.accessToken))
      .send({ filename: 'farm.jpg', mimeType: 'image/jpeg', size: 4096 });
    expect([403, 404]).toContain(res.status);
  });

  it('an approved farm with an EXPIRED subscription stays locked for the owner', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await setFarmSubscriptionAsAdmin(app, admin.accessToken, farm.id, {
      startDate: '2020-01-01',
      endDate: '2020-02-01',
    });
    const res = await request(app)
      .post(`/api/v1/organizations/${farm.id}/farm/profile/image/upload-url`)
      .set(bearer(owner.accessToken))
      .send({ filename: 'farm.jpg', mimeType: 'image/jpeg', size: 4096 });
    expect(res.status).toBe(403);
  });
});
