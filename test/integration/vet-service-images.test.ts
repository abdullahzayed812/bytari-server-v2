import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  fixtureBytes,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();
const API = '/api/v1';

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const LISTING = {
  title: 'تلقيح دواجن',
  description: 'خدمة تلقيح وتحصين الدواجن للوقاية من الأمراض وتحسين الإنتاج',
  serviceType: 'VACCINATION',
  animalType: 'POULTRY',
  governorate: 'نينوى',
  district: 'الموصل',
  priceAmount: '150000',
  priceType: 'APPROXIMATE',
  locationMode: 'FIELD_VISIT',
  details: ['متابعة وتنظيم القطيع قبل التطعيم'],
};

/** presign → PUT (simulated) — the same two steps the app performs. */
async function uploadImage(token: string, mimeType = 'image/jpeg'): Promise<string> {
  const presign = await request(app)
    .post(`${API}/vet-services/images/upload-url`)
    .set(bearer(token))
    .send({ filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1024 });
  expect(presign.status).toBe(201);
  const storageKey = presign.body.data.storageKey as string;
  await container.objectStorage.put(storageKey, fixtureBytes(mimeType, 1024), {
    contentType: mimeType,
  });
  return storageKey;
}

describe('vet services — service images and pet-owner request images', () => {
  it('a listing image reaches the card list, the details and the admin review', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const owner = await registerUser(app);

    const key = await uploadImage(vet.accessToken);
    const created = await request(app)
      .post(`${API}/vet-services/listings`)
      .set(bearer(vet.accessToken))
      .send({ ...LISTING, imageKeys: [key] });
    expect(created.status).toBe(201);
    expect(created.body.data.imageUrls).toHaveLength(1);
    expect(JSON.stringify(created.body.data)).not.toContain('imageKeys');
    const id = created.body.data.id as string;

    const adminView = await request(app)
      .get(`${API}/admin/vet-service-listings/${id}`)
      .set(bearer(admin.accessToken));
    expect(adminView.body.data.imageUrls).toHaveLength(1);
    await request(app)
      .post(`${API}/admin/vet-service-listings/${id}/approve`)
      .set(bearer(admin.accessToken));

    const list = await request(app)
      .get(`${API}/vet-services/listings`)
      .set(bearer(owner.accessToken));
    const card = (list.body.data as Array<{ id: string; imageUrls: string[] }>).find(
      (l) => l.id === id,
    );
    expect(card?.imageUrls).toHaveLength(1);

    const detail = await request(app)
      .get(`${API}/vet-services/listings/${id}`)
      .set(bearer(owner.accessToken));
    expect(detail.body.data.imageUrls).toHaveLength(1);
  });

  it("a pet owner's request image is visible to the provider (signed) and never to a stranger", async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const owner = await registerUser(app);
    const stranger = await registerUser(app);

    const listing = await request(app)
      .post(`${API}/vet-services/listings`)
      .set(bearer(vet.accessToken))
      .send(LISTING);
    await request(app)
      .post(`${API}/admin/vet-service-listings/${listing.body.data.id}/approve`)
      .set(bearer(admin.accessToken));

    const key = await uploadImage(owner.accessToken);
    const lr = await request(app)
      .post(`${API}/vet-services/listings/${listing.body.data.id}/requests`)
      .set(bearer(owner.accessToken))
      .send({ animalType: 'POULTRY', notes: 'صورة الحالة', imageKeys: [key] });
    expect(lr.status).toBe(201);
    const lrId = lr.body.data.id as string;

    const asVet = await request(app)
      .get(`${API}/vet-services/listing-requests/${lrId}`)
      .set(bearer(vet.accessToken));
    expect(asVet.status).toBe(200);
    expect(asVet.body.data.imageUrls).toHaveLength(1);
    // private image → short-lived signed URL, never the public CDN URL
    // (in-memory storage: `op=get`; R2: an `X-Amz-Signature` query)
    expect(asVet.body.data.imageUrls[0]).toMatch(/op=get|X-Amz-Signature=/);

    const asStranger = await request(app)
      .get(`${API}/vet-services/listing-requests/${lrId}`)
      .set(bearer(stranger.accessToken));
    expect([403, 404]).toContain(asStranger.status);
  });

  it("a pet owner's service-request image is shown to vets and the admin", async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const owner = await registerUser(app);

    const key = await uploadImage(owner.accessToken);
    const created = await request(app)
      .post(`${API}/vet-services/requests`)
      .set(bearer(owner.accessToken))
      .send({
        title: 'علاج قطيع',
        description: 'أحتاج طبيباً لمعاينة قطيع أغنام مريض',
        animalType: 'SHEEP',
        serviceType: 'TREATMENT',
        governorate: 'نينوى',
        imageKeys: [key],
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const adminView = await request(app)
      .get(`${API}/admin/vet-service-requests/${id}`)
      .set(bearer(admin.accessToken));
    expect(adminView.body.data.imageUrls).toHaveLength(1);
    await request(app)
      .post(`${API}/admin/vet-service-requests/${id}/approve`)
      .set(bearer(admin.accessToken));

    const asVet = await request(app)
      .get(`${API}/vet-services/requests/${id}`)
      .set(bearer(vet.accessToken));
    expect(asVet.body.data.imageUrls).toHaveLength(1);
  });

  it('rejects a key outside the vet-service prefix, a missing upload and a non-image object', async () => {
    const vet = await registerApprovedVet(app);

    const foreign = await request(app)
      .post(`${API}/vet-services/listings`)
      .set(bearer(vet.accessToken))
      .send({ ...LISTING, imageKeys: ['avatars/2026/01/x.jpg'] });
    expect(foreign.status).toBe(400);

    const presign = await request(app)
      .post(`${API}/vet-services/images/upload-url`)
      .set(bearer(vet.accessToken))
      .send({ filename: 'x.jpg', mimeType: 'image/jpeg', size: 1024 });
    const missing = await request(app)
      .post(`${API}/vet-services/listings`)
      .set(bearer(vet.accessToken))
      .send({ ...LISTING, imageKeys: [presign.body.data.storageKey] });
    expect(missing.status).toBe(400);

    const pdfKey = await uploadImage(vet.accessToken, 'application/pdf');
    const pdf = await request(app)
      .post(`${API}/vet-services/listings`)
      .set(bearer(vet.accessToken))
      .send({ ...LISTING, imageKeys: [pdfKey] });
    expect(pdf.status).toBe(400);
  });
});
