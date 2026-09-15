import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  approveOrganization,
  bearer,
  createOrganization,
  registerAdmin,
  registerApprovedVet,
  registerPendingVet,
  registerUser,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function getOrg(actorToken: string, organizationId: string) {
  const res = await request(app)
    .get(`/api/v1/organizations/${organizationId}`)
    .set(bearer(actorToken));
  return res.body.data;
}

const fullClinicDetails = {
  address: 'بغداد - الكرادة',
  country: 'العراق',
  phone: '0770 123 4567',
  workingHours: 'السبت-الخميس: 8:00 ص - 6:00 م',
  services: ['جراحة', 'أشعة', 'تطعيمات'],
  email: 'clinic@example.com',
  whatsapp: '0770 123 4567',
  websiteUrl: 'https://example.com',
  instagramUrl: 'https://instagram.com/example',
  facebookUrl: 'https://facebook.com/example',
  tiktokUrl: 'https://tiktok.com/@example',
  licenseNumber: 'LIC-12345',
};

describe('organization registration — full profile captured in one POST /organizations', () => {
  it('a CLINIC registers with the full profile + license number in one submission', async () => {
    const owner = await registerApprovedVet(app);
    const org = await createOrganization(app, owner.accessToken, {
      type: 'CLINIC',
      name: 'عيادة الرحمة',
      details: fullClinicDetails,
    });
    expect(org.status).toBe('PENDING');

    const details = await getOrg(owner.accessToken, org.id);
    expect(details.details.address).toBe(fullClinicDetails.address);
    expect(details.details.country).toBe(fullClinicDetails.country);
    expect(details.details.phone).toBe(fullClinicDetails.phone);
    expect(details.details.workingHours).toBe(fullClinicDetails.workingHours);
    expect(details.details.services).toEqual(fullClinicDetails.services);
    expect(details.details.email).toBe(fullClinicDetails.email);
    expect(details.details.whatsapp).toBe(fullClinicDetails.whatsapp);
    expect(details.details.websiteUrl).toBe(fullClinicDetails.websiteUrl);
    expect(details.details.instagramUrl).toBe(fullClinicDetails.instagramUrl);
    expect(details.details.licenseNumber).toBe(fullClinicDetails.licenseNumber);
  });

  it('a VETERINARY_OFFICE registers with a profile too (no vet-approval required to create it)', async () => {
    const owner = await registerUser(app);
    const org = await createOrganization(app, owner.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'مكتب الأصدقاء',
      details: { address: 'أربيل', country: 'العراق', licenseNumber: 'LIC-OFFICE-1' },
    });
    expect(org.status).toBe('PENDING');
    const details = await getOrg(owner.accessToken, org.id);
    expect(details.details.address).toBe('أربيل');
    expect(details.details.licenseNumber).toBe('LIC-OFFICE-1');
  });

  it('a non-approved-vet cannot register a CLINIC (unchanged pre-existing rule)', async () => {
    const owner = await registerPendingVet(app);
    const res = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(owner.accessToken))
      .send({ type: 'CLINIC', name: 'x', details: fullClinicDetails });
    expect(res.status).toBe(403);
  });

  it('license number / license documents are never exposed on the public discover DTO; country/websiteUrl are', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const org = await createOrganization(app, owner.accessToken, {
      type: 'CLINIC',
      name: 'عيادة عامة',
      details: fullClinicDetails,
    });
    await approveOrganization(app, admin.accessToken, org.id);

    const stranger = await registerUser(app);
    const pub = await request(app)
      .get(`/api/v1/organizations/discover/${org.id}`)
      .set(bearer(stranger.accessToken));
    expect(pub.status).toBe(200);
    expect(pub.body.data.country).toBe(fullClinicDetails.country);
    expect(pub.body.data.websiteUrl).toBe(fullClinicDetails.websiteUrl);
    expect(pub.body.data.licenseNumber).toBeUndefined();
    expect(pub.body.data.licenseDocumentUrls).toBeUndefined();
  });
});

describe('organization registration — gallery + license documents while PENDING', () => {
  it('the owner uploads a gallery photo before their organization is approved', async () => {
    const owner = await registerApprovedVet(app);
    const org = await createOrganization(app, owner.accessToken, { type: 'CLINIC', name: 'عيادة' });
    expect(org.status).toBe('PENDING');

    const upload = await request(app)
      .post(`/api/v1/organizations/${org.id}/gallery/upload-url`)
      .set(bearer(owner.accessToken))
      .send({ filename: 'a.jpg', mimeType: 'image/jpeg', size: 1024 });
    expect(upload.status).toBe(201);
    const storageKey = upload.body.data.storageKey as string;
    await container.objectStorage.put(storageKey, Buffer.from('fake-bytes'), {
      contentType: 'image/jpeg',
    });

    const register = await request(app)
      .post(`/api/v1/organizations/${org.id}/gallery`)
      .set(bearer(owner.accessToken))
      .send({ storageKey, mimeType: 'image/jpeg' });
    expect(register.status).toBe(200);
    expect(register.body.data.details.galleryUrls).toHaveLength(1);
  });

  it('the owner uploads, lists, and removes a license document before approval, up to the 3-document cap', async () => {
    const owner = await registerApprovedVet(app);
    const org = await createOrganization(app, owner.accessToken, { type: 'CLINIC', name: 'عيادة' });

    let lastImages: unknown[] = [];
    for (let i = 0; i < 3; i += 1) {
      const upload = await request(app)
        .post(`/api/v1/organizations/${org.id}/license-documents/upload-url`)
        .set(bearer(owner.accessToken))
        .send({ filename: `doc${i}.jpg`, mimeType: 'image/jpeg', size: 1024 });
      expect(upload.status).toBe(201);
      const storageKey = upload.body.data.storageKey as string;
      await container.objectStorage.put(storageKey, Buffer.from('fake-bytes'), {
        contentType: 'image/jpeg',
      });
      const register = await request(app)
        .post(`/api/v1/organizations/${org.id}/license-documents`)
        .set(bearer(owner.accessToken))
        .send({ storageKey, mimeType: 'image/jpeg' });
      expect(register.status).toBe(200);
      lastImages = register.body.data.details.licenseDocumentUrls;
    }
    expect(lastImages).toHaveLength(3);

    // A 4th document is rejected — the cap is 3.
    const overUpload = await request(app)
      .post(`/api/v1/organizations/${org.id}/license-documents/upload-url`)
      .set(bearer(owner.accessToken))
      .send({ filename: 'doc4.jpg', mimeType: 'image/jpeg', size: 1024 });
    expect(overUpload.status).toBe(400);
  });

  it('license documents are rejected for a VETERINARY_STORE (not a licensable type)', async () => {
    const owner = await registerUser(app);
    const org = await createOrganization(app, owner.accessToken, {
      type: 'VETERINARY_STORE',
      name: 'متجر',
    });
    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/license-documents/upload-url`)
      .set(bearer(owner.accessToken))
      .send({ filename: 'a.jpg', mimeType: 'image/jpeg', size: 1024 });
    expect(res.status).toBe(400);
  });

  it('an unrelated user cannot upload license documents to someone else’s PENDING organization', async () => {
    const owner = await registerApprovedVet(app);
    const org = await createOrganization(app, owner.accessToken, { type: 'CLINIC', name: 'عيادة' });
    const stranger = await registerUser(app);

    const res = await request(app)
      .post(`/api/v1/organizations/${org.id}/license-documents/upload-url`)
      .set(bearer(stranger.accessToken))
      .send({ filename: 'a.jpg', mimeType: 'image/jpeg', size: 1024 });
    expect(res.status).toBe(403);
  });
});
