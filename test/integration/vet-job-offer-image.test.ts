import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  approveVetJobOffer,
  bearer,
  fixtureBytes,
  registerAdmin,
  registerApprovedVet,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();
const API = '/api/v1/vet-jobs';

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

/** Presign + upload an attachment the way the app does; returns its storage key. */
async function upload(token: string, filename: string, mimeType: string): Promise<string> {
  const presign = await request(app)
    .post(`${API}/attachments/upload-url`)
    .set(bearer(token))
    .send({ filename, mimeType, size: 1024 });
  expect(presign.status).toBe(201);
  const key = presign.body.data.storageKey as string;
  await container.objectStorage.put(key, fixtureBytes(mimeType, 1024), { contentType: mimeType });
  return key;
}

const createOffer = (token: string, imageStorageKey?: string) =>
  request(app).post(`${API}/offers`).set(bearer(token)).send({
    organizationName: 'مركز الحياة البيطري',
    title: 'طبيب بيطري عام',
    employmentType: 'FULL_TIME',
    governorate: 'بغداد',
    description: 'مطلوب طبيب بيطري عام للعمل في عيادتنا.',
    contactPhone: '07701234567',
    imageStorageKey,
  });

describe('job offer image (optional, uploaded by the poster)', () => {
  it('is the offer image in the public list and the owner view; replace and remove work', async () => {
    const admin = await registerAdmin(app);
    const poster = await registerApprovedVet(app);
    const key = await upload(poster.accessToken, 'offer.png', 'image/png');

    const created = await createOffer(poster.accessToken, key);
    expect(created.status).toBe(201);
    expect(created.body.data.imageUrl).toContain(key);
    expect(created.body.data.hasOwnImage).toBe(true);
    expect(created.body.data).not.toHaveProperty('imageStorageKey');
    const id = created.body.data.id as string;

    await approveVetJobOffer(app, admin.accessToken, id);
    const list = await request(app).get(`${API}/offers`).set(bearer(poster.accessToken));
    expect(list.body.data[0].imageUrl).toContain(key);
    expect(list.body.data[0]).not.toHaveProperty('imageStorageKey');

    const next = await upload(poster.accessToken, 'offer2.jpg', 'image/jpeg');
    const replaced = await request(app)
      .patch(`${API}/offers/${id}`)
      .set(bearer(poster.accessToken))
      .send({ imageStorageKey: next });
    expect(replaced.status).toBe(200);
    expect(replaced.body.data.imageUrl).toContain(next);
    expect(await container.objectStorage.head(key)).toBeNull();

    const removed = await request(app)
      .patch(`${API}/offers/${id}`)
      .set(bearer(poster.accessToken))
      .send({ imageStorageKey: null });
    expect(removed.status).toBe(200);
    expect(removed.body.data.imageUrl).toBeNull();
    expect(removed.body.data.hasOwnImage).toBe(false);
  });

  it('rejects a non-image file and a key that was never uploaded', async () => {
    const poster = await registerApprovedVet(app);
    const pdf = await upload(poster.accessToken, 'cv.pdf', 'application/pdf');
    expect((await createOffer(poster.accessToken, pdf)).status).toBe(400);
    expect((await createOffer(poster.accessToken, 'avatars/someone.png')).status).toBe(400);
  });
});
