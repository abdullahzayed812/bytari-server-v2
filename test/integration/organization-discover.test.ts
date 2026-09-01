import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createActiveOrganization,
  createOrganization,
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

describe('GET /organizations/discover — clinics / offices / stores', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/organizations/discover?type=CLINIC');
    expect(res.status).toBe(401);
  });

  it('lists ACTIVE clinics, offices and stores for any authenticated user (not just members)', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const clinic = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Alpha Clinic',
    });

    // VETERINARY_OFFICE / VETERINARY_STORE owners need no vet approval.
    const plain = await registerUser(app);
    const office = await createActiveOrganization(app, plain.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'Alpha Office',
    });
    const store = await createActiveOrganization(app, plain.accessToken, admin.accessToken, {
      type: 'VETERINARY_STORE',
      name: 'Alpha Store',
    });

    const outsider = await registerUser(app);

    for (const [type, org] of [
      ['CLINIC', clinic],
      ['VETERINARY_OFFICE', office],
      ['VETERINARY_STORE', store],
    ] as const) {
      const res = await request(app)
        .get(`/api/v1/organizations/discover?type=${type}`)
        .set(bearer(outsider.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.map((o: { id: string }) => o.id)).toEqual([org.id]);
      expect(res.body.data[0]).toMatchObject({
        id: org.id,
        type,
        address: null,
        latitude: null,
        longitude: null,
        phone: null,
        logoUrl: null,
        distanceKm: null,
      });
      // Owner/decision metadata never leaks into the public DTO.
      expect(res.body.data[0]).not.toHaveProperty('ownerUserId');
      expect(res.body.data[0]).not.toHaveProperty('decidedBy');
    }
  });

  it('excludes PENDING, SUSPENDED, REJECTED and DEACTIVATED organizations', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const outsider = await registerUser(app);

    const pending = await createOrganization(app, vet.accessToken, {
      type: 'CLINIC',
      name: 'Pending Clinic',
    });

    const rejectedVet = await registerApprovedVet(app);
    const rejected = await createOrganization(app, rejectedVet.accessToken, {
      type: 'CLINIC',
      name: 'Rejected Clinic',
    });
    await request(app)
      .post(`/api/v1/admin/organizations/${rejected.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'no' });

    const suspendedVet = await registerApprovedVet(app);
    const suspended = await createActiveOrganization(
      app,
      suspendedVet.accessToken,
      admin.accessToken,
      {
        type: 'CLINIC',
        name: 'Suspended Clinic',
      },
    );
    await request(app)
      .post(`/api/v1/admin/organizations/${suspended.id}/suspend`)
      .set(bearer(admin.accessToken));

    const active = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Active Clinic',
    });

    const res = await request(app)
      .get('/api/v1/organizations/discover?type=CLINIC')
      .set(bearer(outsider.accessToken));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((o: { id: string }) => o.id);
    expect(ids).toEqual([active.id]);
    expect(ids).not.toContain(pending.id);
    expect(ids).not.toContain(rejected.id);
    expect(ids).not.toContain(suspended.id);
  });

  it('paginates results', async () => {
    const admin = await registerAdmin(app);
    const outsider = await registerUser(app);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const owner = await registerUser(app);
      const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
        type: 'VETERINARY_STORE',
        name: `Store ${i}`,
      });
      ids.push(org.id);
    }

    const page1 = await request(app)
      .get('/api/v1/organizations/discover?type=VETERINARY_STORE&page=1&pageSize=2')
      .set(bearer(outsider.accessToken));
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });

    const page2 = await request(app)
      .get('/api/v1/organizations/discover?type=VETERINARY_STORE&page=2&pageSize=2')
      .set(bearer(outsider.accessToken));
    expect(page2.body.data).toHaveLength(1);

    const seen = new Set([...page1.body.data, ...page2.body.data].map((o: { id: string }) => o.id));
    expect(seen.size).toBe(3);
    for (const id of ids) expect(seen.has(id)).toBe(true);
  });

  it('filters by search (case-insensitive substring on name)', async () => {
    const admin = await registerAdmin(app);
    const outsider = await registerUser(app);
    const ownerA = await registerUser(app);
    const ownerB = await registerUser(app);
    const match = await createActiveOrganization(app, ownerA.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'Downtown Paws Office',
    });
    await createActiveOrganization(app, ownerB.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'Uptown Office',
    });

    const res = await request(app)
      .get('/api/v1/organizations/discover?type=VETERINARY_OFFICE&search=paws')
      .set(bearer(outsider.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.map((o: { id: string }) => o.id)).toEqual([match.id]);
  });

  describe('nearest sorting', () => {
    it('orders by server-computed distance, nearest first', async () => {
      const admin = await registerAdmin(app);
      const outsider = await registerUser(app);

      const near = await registerApprovedVet(app);
      const mid = await registerApprovedVet(app);
      const far = await registerApprovedVet(app);
      const orgNear = await createActiveOrganization(app, near.accessToken, admin.accessToken, {
        type: 'CLINIC',
        name: 'Near Clinic',
      });
      const orgMid = await createActiveOrganization(app, mid.accessToken, admin.accessToken, {
        type: 'CLINIC',
        name: 'Mid Clinic',
      });
      const orgFar = await createActiveOrganization(app, far.accessToken, admin.accessToken, {
        type: 'CLINIC',
        name: 'Far Clinic',
      });

      // Reference point: 33.3000, 44.3000.
      await setProfile(orgNear.id, near.accessToken, { latitude: 33.301, longitude: 44.301 });
      await setProfile(orgMid.id, mid.accessToken, { latitude: 33.5, longitude: 44.5 });
      await setProfile(orgFar.id, far.accessToken, { latitude: 36.0, longitude: 47.0 });

      const res = await request(app)
        .get('/api/v1/organizations/discover?type=CLINIC&sort=nearest&lat=33.3&lng=44.3')
        .set(bearer(outsider.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.map((o: { id: string }) => o.id)).toEqual([
        orgNear.id,
        orgMid.id,
        orgFar.id,
      ]);
      const distances = res.body.data.map((o: { distanceKm: number }) => o.distanceKm);
      expect(distances[0]).toBeLessThan(distances[1]);
      expect(distances[1]).toBeLessThan(distances[2]);
    });

    it('sorts organizations without coordinates to the end', async () => {
      const admin = await registerAdmin(app);
      const outsider = await registerUser(app);
      const withCoords = await registerApprovedVet(app);
      const withoutCoords = await registerApprovedVet(app);

      const orgWith = await createActiveOrganization(
        app,
        withCoords.accessToken,
        admin.accessToken,
        {
          type: 'CLINIC',
          name: 'Located Clinic',
        },
      );
      const orgWithout = await createActiveOrganization(
        app,
        withoutCoords.accessToken,
        admin.accessToken,
        { type: 'CLINIC', name: 'Unlocated Clinic' },
      );
      await setProfile(orgWith.id, withCoords.accessToken, { latitude: 33.3, longitude: 44.3 });

      const res = await request(app)
        .get('/api/v1/organizations/discover?type=CLINIC&sort=nearest&lat=33.3&lng=44.3')
        .set(bearer(outsider.accessToken));
      expect(res.body.data.map((o: { id: string }) => o.id)).toEqual([orgWith.id, orgWithout.id]);
      expect(res.body.data[1].distanceKm).toBeNull();
    });

    it('rejects sort=nearest without lat/lng (422)', async () => {
      const user = await registerUser(app);
      const res = await request(app)
        .get('/api/v1/organizations/discover?type=CLINIC&sort=nearest')
        .set(bearer(user.accessToken));
      expect(res.status).toBe(422);
    });

    it('rejects a lone lat without lng (422)', async () => {
      const user = await registerUser(app);
      const res = await request(app)
        .get('/api/v1/organizations/discover?type=CLINIC&lat=33.3')
        .set(bearer(user.accessToken));
      expect(res.status).toBe(422);
    });

    it('rejects out-of-range coordinates (422)', async () => {
      const user = await registerUser(app);
      const res = await request(app)
        .get('/api/v1/organizations/discover?type=CLINIC&sort=nearest&lat=999&lng=44')
        .set(bearer(user.accessToken));
      expect(res.status).toBe(422);
    });
  });
});

describe('GET /organizations/discover/:organizationId', () => {
  it('returns the full public profile for one ACTIVE organization', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const outsider = await registerUser(app);
    const org = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Detail Clinic',
    });
    await setProfile(org.id, vet.accessToken, {
      address: '123 Main St',
      phone: '+1 555 0100',
      latitude: 33.3,
      longitude: 44.3,
    });

    const res = await request(app)
      .get(`/api/v1/organizations/discover/${org.id}`)
      .set(bearer(outsider.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: org.id,
      name: 'Detail Clinic',
      address: '123 Main St',
      phone: '+1 555 0100',
      latitude: 33.3,
      longitude: 44.3,
    });
    expect(res.body.data).not.toHaveProperty('ownerUserId');
  });

  it('404s for a non-ACTIVE (e.g. PENDING) organization', async () => {
    const vet = await registerApprovedVet(app);
    const outsider = await registerUser(app);
    const org = await createOrganization(app, vet.accessToken, { type: 'CLINIC', name: 'Pending' });

    const res = await request(app)
      .get(`/api/v1/organizations/discover/${org.id}`)
      .set(bearer(outsider.accessToken));
    expect(res.status).toBe(404);
  });

  it('404s for an unknown id', async () => {
    const outsider = await registerUser(app);
    const res = await request(app)
      .get('/api/v1/organizations/discover/00000000-0000-0000-0000-000000000000')
      .set(bearer(outsider.accessToken));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /organizations/:id — profile fields', () => {
  it('lets the OWNER set address/phone/coordinates', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const org = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Profile Clinic',
    });

    const data = await setProfile(org.id, vet.accessToken, {
      address: 'New address',
      phone: '+1 555 9999',
      latitude: 10,
      longitude: 20,
    });
    expect(data.details).toMatchObject({
      address: 'New address',
      phone: '+1 555 9999',
      latitude: 10,
      longitude: 20,
    });
  });

  it('rejects profile fields for FARM organizations (400 ORGANIZATION_TYPE_NOT_SUPPORTED)', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const farm = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
      type: 'FARM',
      name: 'A Farm',
    });

    const res = await request(app)
      .patch(`/api/v1/organizations/${farm.id}`)
      .set(bearer(vet.accessToken))
      .send({ address: 'Somewhere' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
  });

  it('rejects a lone latitude without longitude (422)', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const org = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Half Coords Clinic',
    });

    const res = await request(app)
      .patch(`/api/v1/organizations/${org.id}`)
      .set(bearer(vet.accessToken))
      .send({ latitude: 10 });
    expect(res.status).toBe(422);
  });

  it('rejects a non-member from updating the profile (403)', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const outsider = await registerUser(app);
    const org = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Guarded Clinic',
    });

    const res = await request(app)
      .patch(`/api/v1/organizations/${org.id}`)
      .set(bearer(outsider.accessToken))
      .send({ address: 'Hacked' });
    expect(res.status).toBe(403);
  });
});

describe('organization logo upload', () => {
  it('OWNER can request an upload URL and register the logo', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const org = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Logo Clinic',
    });

    const upload = await request(app)
      .post(`/api/v1/organizations/${org.id}/logo/upload-url`)
      .set(bearer(vet.accessToken))
      .send({ filename: 'logo.png', mimeType: 'image/png', size: 1024 });
    expect(upload.status).toBe(201);
    const { storageKey } = upload.body.data as { storageKey: string };
    expect(storageKey).toMatch(/^organizations\//);

    await container.objectStorage.put(storageKey, Buffer.from('fake-png'), {
      contentType: 'image/png',
    });

    const finalize = await request(app)
      .post(`/api/v1/organizations/${org.id}/logo`)
      .set(bearer(vet.accessToken))
      .send({ storageKey, mimeType: 'image/png' });
    expect(finalize.status).toBe(200);
    expect(finalize.body.data.details.logoUrl).toBeTruthy();

    const discover = await request(app)
      .get(`/api/v1/organizations/discover/${org.id}`)
      .set(bearer(vet.accessToken));
    expect(discover.body.data.logoUrl).toBeTruthy();
  });

  it('rejects logo upload for FARM organizations (400)', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const farm = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
      type: 'FARM',
      name: 'Logo Farm',
    });

    const res = await request(app)
      .post(`/api/v1/organizations/${farm.id}/logo/upload-url`)
      .set(bearer(vet.accessToken))
      .send({ filename: 'logo.png', mimeType: 'image/png', size: 1024 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ORGANIZATION_TYPE_NOT_SUPPORTED');
  });

  it('rejects a non-member (403)', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const outsider = await registerUser(app);
    const org = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Guarded Logo Clinic',
    });

    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/logo/upload-url`)
      .set(bearer(outsider.accessToken))
      .send({ filename: 'logo.png', mimeType: 'image/png', size: 1024 });
    expect(res.status).toBe(403);
  });

  it('rejects finalizing a storage key that does not belong to this upload target (409)', async () => {
    const vet = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const org = await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Mismatch Clinic',
    });

    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/logo`)
      .set(bearer(vet.accessToken))
      .send({ storageKey: 'users/avatars/2026/09/whatever.png', mimeType: 'image/png' });
    expect(res.status).toBe(409);
  });

  it('cross-organization: a STAFF member of org A cannot upload a logo to org B', async () => {
    const ownerA = await registerApprovedVet(app);
    const ownerB = await registerApprovedVet(app);
    const admin = await registerAdmin(app);
    const staff = await registerUser(app);

    const orgA = await createActiveOrganization(app, ownerA.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Org A',
    });
    const orgB = await createActiveOrganization(app, ownerB.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Org B',
    });
    await addOrganizationMember(app, ownerA.accessToken, orgA.id, {
      userId: staff.id,
      role: 'STAFF',
    });

    // STAFF of A has no `organization.update` on A by default (owner-only), and none on B at all.
    const resA = await request(app)
      .post(`/api/v1/organizations/${orgA.id}/logo/upload-url`)
      .set(bearer(staff.accessToken))
      .send({ filename: 'logo.png', mimeType: 'image/png', size: 1024 });
    expect(resA.status).toBe(403);

    const resB = await request(app)
      .post(`/api/v1/organizations/${orgB.id}/logo/upload-url`)
      .set(bearer(staff.accessToken))
      .send({ filename: 'logo.png', mimeType: 'image/png', size: 1024 });
    expect(resB.status).toBe(403);
  });
});
