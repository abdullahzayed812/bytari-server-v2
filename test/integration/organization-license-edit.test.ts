import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  assignOrganizationSupervisor,
  bearer,
  createActiveOrganization,
  createOrganization,
  fixtureBytes,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function uploadLicense(
  token: string,
  organizationId: string,
  name: string,
  replacesStorageKey?: string,
) {
  const extra = replacesStorageKey ? { replacesStorageKey } : {};
  const upload = await request(app)
    .post(`/api/v1/organizations/${organizationId}/license-documents/upload-url`)
    .set(bearer(token))
    .send({ filename: name, mimeType: 'image/jpeg', size: 1024, ...extra });
  expect(upload.status).toBe(201);
  const storageKey = upload.body.data.storageKey as string;
  await container.objectStorage.put(storageKey, fixtureBytes('image/jpeg', 1024), {
    contentType: 'image/jpeg',
  });
  const res = await request(app)
    .post(`/api/v1/organizations/${organizationId}/license-documents`)
    .set(bearer(token))
    .send({ storageKey, mimeType: 'image/jpeg', ...extra });
  return { res, storageKey };
}

describe('clinic / office license editing (settings)', () => {
  it('replaces a license photo in place even at the 3-photo cap, and deletes the old object', async () => {
    const owner = await registerApprovedVet(app);
    const org = await createOrganization(app, owner.accessToken, { type: 'CLINIC', name: 'عيادة' });
    const keys: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { res, storageKey } = await uploadLicense(owner.accessToken, org.id, `d${i}.jpg`);
      expect(res.status).toBe(200);
      keys.push(storageKey);
    }

    const { res, storageKey: newKey } = await uploadLicense(
      owner.accessToken,
      org.id,
      'new.jpg',
      keys[1],
    );
    expect(res.status).toBe(200);
    expect(res.body.data.details.licenseDocumentKeys).toEqual([keys[0], newKey, keys[2]]);
    expect(await container.objectStorage.head(keys[1]!)).toBeNull();
  });

  it('replacing a key that is not on the organization is a 404', async () => {
    const owner = await registerApprovedVet(app);
    const org = await createOrganization(app, owner.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'مكتب',
    });
    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/license-documents/upload-url`)
      .set(bearer(owner.accessToken))
      .send({
        filename: 'a.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
        replacesStorageKey: 'organization-license-documents/not-mine.jpg',
      });
    expect(res.status).toBe(404);
  });

  it('removes a license photo, then a new one can be uploaded', async () => {
    const owner = await registerApprovedVet(app);
    const org = await createOrganization(app, owner.accessToken, { type: 'CLINIC', name: 'عيادة' });
    const { storageKey } = await uploadLicense(owner.accessToken, org.id, 'a.jpg');
    const del = await request(app)
      .delete(
        `/api/v1/organizations/${org.id}/license-documents?storageKey=${encodeURIComponent(storageKey)}`,
      )
      .set(bearer(owner.accessToken));
    expect(del.status).toBe(200);
    expect(del.body.data.details.licenseDocumentKeys).toEqual([]);
    const { res } = await uploadLicense(owner.accessToken, org.id, 'b.jpg');
    expect(res.status).toBe(200);
    expect(res.body.data.details.licenseDocumentUrls).toHaveLength(1);
  });

  it('the owner can edit the license number while the organization is still PENDING', async () => {
    const owner = await registerApprovedVet(app);
    const org = await createOrganization(app, owner.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'مكتب',
      details: { licenseNumber: 'OLD-1' },
    });
    expect(org.status).toBe('PENDING');
    const res = await request(app)
      .patch(`/api/v1/organizations/${org.id}`)
      .set(bearer(owner.accessToken))
      .send({ licenseNumber: 'NEW-2' });
    expect(res.status).toBe(200);
    expect(res.body.data.details.licenseNumber).toBe('NEW-2');
  });

  it('a stranger cannot edit the license number or replace license photos', async () => {
    const owner = await registerApprovedVet(app);
    const org = await createOrganization(app, owner.accessToken, { type: 'CLINIC', name: 'عيادة' });
    const { storageKey } = await uploadLicense(owner.accessToken, org.id, 'a.jpg');
    const stranger = await registerUser(app);
    const patch = await request(app)
      .patch(`/api/v1/organizations/${org.id}`)
      .set(bearer(stranger.accessToken))
      .send({ licenseNumber: 'HIJACK' });
    expect(patch.status).toBe(403);
    const replace = await request(app)
      .post(`/api/v1/organizations/${org.id}/license-documents/upload-url`)
      .set(bearer(stranger.accessToken))
      .send({
        filename: 'x.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
        replacesStorageKey: storageKey,
      });
    expect(replace.status).toBe(403);
  });

  it('an org supervisor granted organization.update manages the license; a plain member cannot', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const sup = await registerApprovedVet(app); // org supervisors must be approved vets
    const staff = await registerUser(app);
    const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'عيادة',
    });
    await assignOrganizationSupervisor(app, owner.accessToken, org.id, {
      userId: sup.id,
      permissions: ['organization.read', 'organization.update'],
    });
    await addOrganizationMember(app, owner.accessToken, org.id, {
      userId: staff.id,
      role: 'STAFF',
    });

    const bySup = await request(app)
      .patch(`/api/v1/organizations/${org.id}`)
      .set(bearer(sup.accessToken))
      .send({ licenseNumber: 'SUP-7' });
    expect(bySup.status).toBe(200);
    expect(bySup.body.data.details.licenseNumber).toBe('SUP-7');
    const { res: supUpload } = await uploadLicense(sup.accessToken, org.id, 'sup.jpg');
    expect(supUpload.status).toBe(200);

    const byStaff = await request(app)
      .patch(`/api/v1/organizations/${org.id}`)
      .set(bearer(staff.accessToken))
      .send({ licenseNumber: 'STAFF-1' });
    expect(byStaff.status).toBe(403);
    const staffRemove = await request(app)
      .delete(`/api/v1/organizations/${org.id}/license-documents`)
      .query({ storageKey: supUpload.body.data.details.licenseDocumentKeys[0] as string })
      .set(bearer(staff.accessToken));
    expect(staffRemove.status).toBe(403);
  });
});
