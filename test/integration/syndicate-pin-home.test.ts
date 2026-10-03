import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  assignSystemSupervisor,
  bearer,
  createSyndicate,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const pin = (token: string, id: string, pinned: boolean) =>
  request(app).put(`/api/v1/admin/syndicates/${id}/pin`).set(bearer(token)).send({ pinned });

describe('Syndicates — pin to Veterinarian Home', () => {
  it('ADMIN / SYNDICATE supervisor pins; it persists and lists on Home; others are refused', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const a = await createSyndicate(app, admin.accessToken, { name: 'نقابة أ' });
    const b = await createSyndicate(app, admin.accessToken, { name: 'نقابة ب' });

    // a plain vet (even a viewer) cannot pin
    expect((await pin(vet.accessToken, a.id, true)).status).toBe(403);

    const res = await pin(admin.accessToken, a.id, true);
    expect(res.status).toBe(200);
    expect(res.body.data.pinnedToHome).toBe(true);

    const sup = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, sup.id, 'SYNDICATE');
    expect((await pin(sup.accessToken, b.id, true)).status).toBe(200);

    const home = await request(app).get('/api/v1/syndicates/pinned').set(bearer(vet.accessToken));
    expect(home.status).toBe(200);
    // oldest pin first; the persisted flag is reflected everywhere
    expect((home.body.data as { id: string }[]).map((s) => s.id)).toEqual([a.id, b.id]);
    const one = await request(app).get(`/api/v1/syndicates/${a.id}`).set(bearer(vet.accessToken));
    expect(one.body.data.pinnedToHome).toBe(true);

    // re-pinning keeps the original order; unpinning removes it
    await pin(admin.accessToken, a.id, true);
    expect((await pin(admin.accessToken, b.id, false)).body.data.pinnedToHome).toBe(false);
    const after = await request(app).get('/api/v1/syndicates/pinned').set(bearer(vet.accessToken));
    expect((after.body.data as { id: string }[]).map((s) => s.id)).toEqual([a.id]);

    // a deleted (deactivated) syndicate drops off Home and cannot be pinned
    await request(app)
      .delete(`/api/v1/admin/syndicates/${a.id}`)
      .set(bearer(admin.accessToken))
      .expect(204);
    const gone = await request(app).get('/api/v1/syndicates/pinned').set(bearer(vet.accessToken));
    expect(gone.body.data).toEqual([]);
    expect((await pin(admin.accessToken, a.id, true)).status).toBe(409);

    // body validation
    const bad = await request(app)
      .put(`/api/v1/admin/syndicates/${b.id}/pin`)
      .set(bearer(admin.accessToken))
      .send({ pinned: 'yes' });
    expect(bad.status).toBe(422);
  });
});
