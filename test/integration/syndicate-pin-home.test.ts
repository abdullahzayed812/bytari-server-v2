import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
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
  request(app).put(`/api/v1/syndicates/${id}/pin`).set(bearer(token)).send({ pinned });
const pinnedIds = async (token: string): Promise<string[]> => {
  const res = await request(app).get('/api/v1/syndicates/pinned').set(bearer(token));
  expect(res.status).toBe(200);
  return (res.body.data as { id: string }[]).map((s) => s.id);
};

describe('Syndicates — per-veterinarian pin to the Veterinarian Home', () => {
  it('every veterinarian pins / unpins for themselves; it persists per user', async () => {
    const admin = await registerAdmin(app);
    const vet1 = await registerApprovedVet(app);
    const vet2 = await registerApprovedVet(app);
    const a = await createSyndicate(app, admin.accessToken, { name: 'نقابة أ' });
    const b = await createSyndicate(app, admin.accessToken, { name: 'نقابة ب' });

    // a plain (non-veterinarian) user is refused by the backend
    const owner = await registerUser(app);
    expect((await pin(owner.accessToken, a.id, true)).status).toBe(403);

    const res = await pin(vet1.accessToken, a.id, true);
    expect(res.status).toBe(200);
    expect(res.body.data.pinnedToHome).toBe(true);
    expect((await pin(vet1.accessToken, b.id, true)).status).toBe(200);

    // oldest pin first; the flag is the VIEWER's own pin
    expect(await pinnedIds(vet1.accessToken)).toEqual([a.id, b.id]);
    expect(await pinnedIds(vet2.accessToken)).toEqual([]);
    const asVet1 = await request(app)
      .get(`/api/v1/syndicates/${a.id}`)
      .set(bearer(vet1.accessToken));
    expect(asVet1.body.data.pinnedToHome).toBe(true);
    const asVet2 = await request(app)
      .get(`/api/v1/syndicates/${a.id}`)
      .set(bearer(vet2.accessToken));
    expect(asVet2.body.data.pinnedToHome).toBe(false);

    // another vet's pin is independent; re-pinning keeps the original order
    expect((await pin(vet2.accessToken, b.id, true)).status).toBe(200);
    await pin(vet1.accessToken, a.id, true);
    expect((await pin(vet1.accessToken, b.id, false)).body.data.pinnedToHome).toBe(false);
    expect(await pinnedIds(vet1.accessToken)).toEqual([a.id]);
    expect(await pinnedIds(vet2.accessToken)).toEqual([b.id]);

    // admins may pin too
    expect((await pin(admin.accessToken, b.id, true)).status).toBe(200);
    expect(await pinnedIds(admin.accessToken)).toEqual([b.id]);

    // a deleted (deactivated) syndicate drops off Home and cannot be pinned
    await request(app)
      .delete(`/api/v1/admin/syndicates/${a.id}`)
      .set(bearer(admin.accessToken))
      .expect(204);
    expect(await pinnedIds(vet1.accessToken)).toEqual([]);
    expect((await pin(vet1.accessToken, a.id, true)).status).toBe(409);

    // the former admin-only route is gone; body validation
    const legacy = await request(app)
      .put(`/api/v1/admin/syndicates/${b.id}/pin`)
      .set(bearer(admin.accessToken))
      .send({ pinned: true });
    expect(legacy.status).toBe(404);
    const bad = await request(app)
      .put(`/api/v1/syndicates/${b.id}/pin`)
      .set(bearer(vet1.accessToken))
      .send({ pinned: 'yes' });
    expect(bad.status).toBe(422);
  });
});
