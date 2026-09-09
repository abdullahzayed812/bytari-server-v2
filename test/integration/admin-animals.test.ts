import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createAnimal,
  registerAdmin,
  registerAnimalSupervisor,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const adminAnimals = (qs = ''): string => `/api/v1/admin/animals${qs}`;

describe('admin animals — oversight list + soft-delete', () => {
  it('an admin (or ANIMAL supervisor) lists EVERY user’s animals with the owner name; a plain user gets 403', async () => {
    const admin = await registerAdmin(app);
    const supervisor = await registerAnimalSupervisor(app, admin.accessToken);
    const a = await registerUser(app, { firstName: 'Aya', lastName: 'Owner' });
    const b = await registerUser(app, { firstName: 'Bilal', lastName: 'Owner' });
    const animA = await createAnimal(app, a.accessToken);
    const animB = await createAnimal(app, b.accessToken);

    const denied = await request(app).get(adminAnimals()).set(bearer(a.accessToken));
    expect(denied.status).toBe(403);

    const asAdmin = await request(app).get(adminAnimals()).set(bearer(admin.accessToken));
    expect(asAdmin.status).toBe(200);
    const rows = asAdmin.body.data as {
      id: string;
      currentOwnerUserId: string;
      ownerName: string;
    }[];
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([animA.id, animB.id]));
    const rowA = rows.find((r) => r.id === animA.id)!;
    expect(rowA.currentOwnerUserId).toBe(a.id);
    expect(rowA.ownerName).toBe('Aya Owner');

    const asSup = await request(app).get(adminAnimals()).set(bearer(supervisor.accessToken));
    expect(asSup.status).toBe(200);

    const filtered = await request(app)
      .get(adminAnimals(`?ownerUserId=${b.id}`))
      .set(bearer(admin.accessToken));
    expect(filtered.body.data.map((r: { id: string }) => r.id)).toEqual([animB.id]);
  });

  it('an admin soft-deletes any user’s animal; a plain user and an ANIMAL supervisor cannot', async () => {
    const admin = await registerAdmin(app);
    const supervisor = await registerAnimalSupervisor(app, admin.accessToken);
    const a = await registerUser(app);
    const animA = await createAnimal(app, a.accessToken);

    // supervisor has animal.read but NOT animal.delete
    const supDel = await request(app)
      .delete(adminAnimals(`/${animA.id}`))
      .set(bearer(supervisor.accessToken));
    expect(supDel.status).toBe(403);

    const userDel = await request(app)
      .delete(adminAnimals(`/${animA.id}`))
      .set(bearer(a.accessToken));
    expect(userDel.status).toBe(403);

    const adminDel = await request(app)
      .delete(adminAnimals(`/${animA.id}`))
      .set(bearer(admin.accessToken));
    expect(adminDel.status).toBe(200);
    expect(adminDel.body.data.status).toBe('DEACTIVATED');

    // idempotent
    const again = await request(app)
      .delete(adminAnimals(`/${animA.id}`))
      .set(bearer(admin.accessToken));
    expect(again.status).toBe(200);

    // unknown id → 404
    const missing = await request(app)
      .delete(adminAnimals('/00000000-0000-0000-0000-000000000000'))
      .set(bearer(admin.accessToken));
    expect(missing.status).toBe(404);
  });
});
