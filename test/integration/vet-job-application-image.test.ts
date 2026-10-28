import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  applyToVetJobOffer,
  approveVetJobOffer,
  bearer,
  createVetJobOffer,
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

async function openOffer() {
  const admin = await registerAdmin(app);
  const poster = await registerApprovedVet(app);
  const offer = await createVetJobOffer(app, poster.accessToken);
  await approveVetJobOffer(app, admin.accessToken, offer.id);
  return { admin, poster, offer };
}

const apply = (token: string, offerId: string, photoStorageKey?: string) =>
  request(app)
    .post(`${API}/offers/${offerId}/applications`)
    .set(bearer(token))
    .send({ fullName: 'د. سارة', phone: '07700000000', photoStorageKey });

describe('job application image (optional, uploaded by the applicant)', () => {
  it('is attached to that application and shown to the poster and the applicant only', async () => {
    const { poster, offer } = await openOffer();
    const applicant = await registerApprovedVet(app);
    const key = await upload(applicant.accessToken, 'me.png', 'image/png');

    const applied = await apply(applicant.accessToken, offer.id, key);
    expect(applied.status).toBe(201);
    expect(applied.body.data.photoUrl).toContain(key);
    expect(applied.body.data).not.toHaveProperty('photoStorageKey');

    // A second applicant without an image.
    const plain = await registerApprovedVet(app);
    expect((await apply(plain.accessToken, offer.id)).status).toBe(201);

    const received = await request(app)
      .get(`${API}/offers/${offer.id}/applications`)
      .set(bearer(poster.accessToken));
    expect(received.status).toBe(200);
    const byApplicant = new Map(
      (received.body.data as { applicant: { id: string }; photoUrl: string | null }[]).map((a) => [
        a.applicant.id,
        a.photoUrl,
      ]),
    );
    expect(byApplicant.get(applicant.id)).toContain(key);
    expect(byApplicant.get(plain.id)).toBeNull();

    const mine = await request(app)
      .get(`${API}/applications/mine`)
      .set(bearer(applicant.accessToken));
    expect(mine.body.data[0].photoUrl).toContain(key);

    // Strangers can't read another offer's applications.
    const stranger = await registerApprovedVet(app);
    const denied = await request(app)
      .get(`${API}/offers/${offer.id}/applications`)
      .set(bearer(stranger.accessToken));
    expect([403, 404]).toContain(denied.status);
  });

  it('rejects a non-image file, a key that was never uploaded, and a foreign storage prefix', async () => {
    const { offer } = await openOffer();
    const applicant = await registerApprovedVet(app);
    const pdf = await upload(applicant.accessToken, 'cv.pdf', 'application/pdf');
    expect((await apply(applicant.accessToken, offer.id, pdf)).status).toBe(400);

    const presign = await request(app)
      .post(`${API}/attachments/upload-url`)
      .set(bearer(applicant.accessToken))
      .send({ filename: 'ghost.png', mimeType: 'image/png', size: 1024 });
    expect(
      (await apply(applicant.accessToken, offer.id, presign.body.data.storageKey)).status,
    ).toBe(400);
    expect((await apply(applicant.accessToken, offer.id, 'avatars/someone.png')).status).toBe(400);

    // Disallowed type / oversize are refused at presign time.
    const gif = await request(app)
      .post(`${API}/attachments/upload-url`)
      .set(bearer(applicant.accessToken))
      .send({ filename: 'a.gif', mimeType: 'image/gif', size: 1024 });
    expect(gif.status).toBe(400);
    const huge = await request(app)
      .post(`${API}/attachments/upload-url`)
      .set(bearer(applicant.accessToken))
      .send({ filename: 'a.png', mimeType: 'image/png', size: 50 * 1024 * 1024 });
    expect(huge.status).toBe(400);

    // Nothing was created by the refused attempts; a plain application still works.
    expect((await applyToVetJobOffer(app, applicant.accessToken, offer.id)).status).toBe(201);
  });
});
