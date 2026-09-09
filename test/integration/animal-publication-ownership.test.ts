import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  approvePublication,
  bearer,
  createAnimal,
  createAnimalPublication,
  registerAdmin,
  registerAnimalSupervisor,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const mine = (qs = ''): string => `/api/v1/animal-publications/mine${qs}`;
const pub = (id: string): string => `/api/v1/animal-publications/${id}`;
const browse = (qs = ''): string => `/api/v1/animal-publications${qs}`;

describe('animal publications — ownership & "my listings" filter', () => {
  it('the public browse returns EVERY user’s approved listings, never scoped to the caller', async () => {
    const admin = await registerAdmin(app);
    const a = await registerUser(app);
    const b = await registerUser(app);
    const animA = await createAnimal(app, a.accessToken);
    const animB = await createAnimal(app, b.accessToken);

    const pubA = await createAnimalPublication(app, a.accessToken, animA.id, { kind: 'ADOPTION' });
    const pubB = await createAnimalPublication(app, b.accessToken, animB.id, { kind: 'ADOPTION' });
    await approvePublication(app, admin.accessToken, pubA.id);
    await approvePublication(app, admin.accessToken, pubB.id);

    const asA = await request(app).get(browse('?kind=ADOPTION')).set(bearer(a.accessToken));
    expect(asA.status).toBe(200);
    const ids = (asA.body.data as { id: string }[]).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([pubA.id, pubB.id]));
  });

  it('GET /animal-publications/mine returns only the caller’s own listings, EVERY status', async () => {
    const admin = await registerAdmin(app);
    const a = await registerUser(app);
    const b = await registerUser(app);
    const animA = await createAnimal(app, a.accessToken);
    const animA2 = await createAnimal(app, a.accessToken);
    const animB = await createAnimal(app, b.accessToken);

    const approved = await createAnimalPublication(app, a.accessToken, animA.id, { kind: 'LOST' });
    await approvePublication(app, admin.accessToken, approved.id);
    const pending = await createAnimalPublication(app, a.accessToken, animA2.id, { kind: 'LOST' });
    // B's listing must never show up in A's "mine"
    await createAnimalPublication(app, b.accessToken, animB.id, { kind: 'LOST' });

    const res = await request(app).get(mine('?kind=LOST')).set(bearer(a.accessToken));
    expect(res.status).toBe(200);
    const items = res.body.data as {
      id: string;
      status: string;
      animalId: string;
      animal: unknown;
    }[];
    expect(items.map((i) => i.id).sort()).toEqual([approved.id, pending.id].sort());
    expect(items.every((i) => 'status' in i && 'rejectionReason' in i)).toBe(true);
    expect(items.every((i) => i.animal != null)).toBe(true);
    expect(items.map((i) => i.status).sort()).toEqual(['APPROVED', 'PENDING']);

    const onlyPending = await request(app)
      .get(mine('?kind=LOST&status=PENDING'))
      .set(bearer(a.accessToken));
    expect(onlyPending.body.data).toHaveLength(1);
    expect(onlyPending.body.data[0].id).toBe(pending.id);

    const bMine = await request(app).get(mine('?kind=LOST')).set(bearer(b.accessToken));
    expect(bMine.body.data.map((i: { id: string }) => i.id)).not.toContain(approved.id);
  });

  it('a user can delete only their OWN listing; another user gets 404', async () => {
    const admin = await registerAdmin(app);
    const a = await registerUser(app);
    const b = await registerUser(app);
    const animA = await createAnimal(app, a.accessToken);
    const p = await createAnimalPublication(app, a.accessToken, animA.id, { kind: 'ADOPTION' });
    await approvePublication(app, admin.accessToken, p.id);

    // B cannot delete A's listing
    const bDel = await request(app).delete(pub(p.id)).set(bearer(b.accessToken));
    expect(bDel.status).toBe(404);
    // still there
    expect((await request(app).get(pub(p.id)).set(bearer(a.accessToken))).status).toBe(200);

    // A deletes their own
    const aDel = await request(app).delete(pub(p.id)).set(bearer(a.accessToken));
    expect(aDel.status).toBe(200);
    expect(aDel.body.data).toEqual({ success: true });

    // gone everywhere
    expect((await request(app).get(pub(p.id)).set(bearer(a.accessToken))).status).toBe(404);
    const aMine = await request(app).get(mine()).set(bearer(a.accessToken));
    expect(aMine.body.data).toHaveLength(0);
    // deleting again → 404
    expect((await request(app).delete(pub(p.id)).set(bearer(a.accessToken))).status).toBe(404);
  });

  it('an ADMIN and an ACTIVE ANIMAL supervisor can delete any listing', async () => {
    const admin = await registerAdmin(app);
    const supervisor = await registerAnimalSupervisor(app, admin.accessToken);
    const a = await registerUser(app);
    const animA = await createAnimal(app, a.accessToken);

    const p1 = await createAnimalPublication(app, a.accessToken, animA.id, { kind: 'LOST' });
    const sup = await request(app).delete(pub(p1.id)).set(bearer(supervisor.accessToken));
    expect(sup.status).toBe(200);

    const animA2 = await createAnimal(app, a.accessToken);
    const p2 = await createAnimalPublication(app, a.accessToken, animA2.id, { kind: 'LOST' });
    const adm = await request(app).delete(pub(p2.id)).set(bearer(admin.accessToken));
    expect(adm.status).toBe(200);
  });

  it('/mine requires authentication', async () => {
    const res = await request(app).get(mine());
    expect(res.status).toBe(401);
  });
});
