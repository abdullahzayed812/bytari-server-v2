import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  applyToVetJobOffer,
  approveVetJobOffer,
  approveVetJobSeekerProfile,
  assignSystemSupervisor,
  bearer,
  createVetJobOffer,
  createVetJobSeekerProfile,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const api = (p: string): string => `/api/v1/vet-jobs${p}`;
const adminApi = (p: string): string => `/api/v1/admin${p}`;

describe('Veterinarian Jobs — applicant counters + Admin delete', () => {
  it('"my offers" carries total + still-pending applicant counts per job', async () => {
    const admin = await registerAdmin(app);
    const poster = await registerUser(app);
    const offer = await createVetJobOffer(app, poster.accessToken);
    await approveVetJobOffer(app, admin.accessToken, offer.id);

    const a1 = await registerApprovedVet(app);
    const a2 = await registerApprovedVet(app);
    const r1 = await applyToVetJobOffer(app, a1.accessToken, offer.id);
    await applyToVetJobOffer(app, a2.accessToken, offer.id);
    await request(app)
      .post(api(`/applications/${r1.body.data.id}/reject`))
      .set(bearer(poster.accessToken));

    const mine = await request(app).get(api('/offers/mine')).set(bearer(poster.accessToken));
    expect(mine.status).toBe(200);
    expect(mine.body.data[0]).toMatchObject({ applicationCount: 2, pendingApplicationCount: 1 });

    // the public projection never exposes the counts
    const pub = await request(app).get(api('/offers')).set(bearer(a1.accessToken));
    expect(pub.body.data[0].applicationCount).toBeUndefined();
  });

  it('ADMIN / VET_JOBS supervisor deletes an approved job; the poster cannot use the admin route', async () => {
    const admin = await registerAdmin(app);
    const poster = await registerUser(app);
    const offer = await createVetJobOffer(app, poster.accessToken);
    await approveVetJobOffer(app, admin.accessToken, offer.id);

    const denied = await request(app)
      .delete(adminApi(`/vet-job-offers/${offer.id}`))
      .set(bearer(poster.accessToken));
    expect(denied.status).toBe(403);

    const sup = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, sup.id, 'VET_JOBS');
    const del = await request(app)
      .delete(adminApi(`/vet-job-offers/${offer.id}`))
      .set(bearer(sup.accessToken));
    expect(del.status).toBe(200);

    const gone = await request(app)
      .get(adminApi(`/vet-job-offers/${offer.id}`))
      .set(bearer(admin.accessToken));
    expect(gone.status).toBe(404);
  });

  it('ADMIN / VET_JOBS supervisor deletes a job-seeker profile; the owner / others cannot use the admin route', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const profile = await createVetJobSeekerProfile(app, vet.accessToken);
    await approveVetJobSeekerProfile(app, admin.accessToken, profile.id);

    for (const token of [vet.accessToken, (await registerUser(app)).accessToken]) {
      const denied = await request(app)
        .delete(adminApi(`/vet-job-seekers/${profile.id}`))
        .set(bearer(token));
      expect(denied.status).toBe(403);
    }

    const sup = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, sup.id, 'VET_JOBS');
    const del = await request(app)
      .delete(adminApi(`/vet-job-seekers/${profile.id}`))
      .set(bearer(sup.accessToken));
    expect(del.status).toBe(200);

    const gone = await request(app)
      .get(adminApi(`/vet-job-seekers/${profile.id}`))
      .set(bearer(admin.accessToken));
    expect(gone.status).toBe(404);
    const browse = await request(app).get(api('/seekers')).set(bearer(admin.accessToken));
    expect(browse.body.data).toHaveLength(0);
    // the veterinarian may create a fresh profile afterwards (unique per user freed)
    const again = await createVetJobSeekerProfile(app, vet.accessToken);
    expect(again.id).not.toBe(profile.id);

    const missing = await request(app)
      .delete(adminApi(`/vet-job-seekers/${profile.id}`))
      .set(bearer(admin.accessToken));
    expect(missing.status).toBe(404);
  });
});
