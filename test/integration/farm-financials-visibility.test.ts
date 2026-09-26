import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createFarm,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('farm financials are owner/admin-only (backend-enforced)', () => {
  it('redacts the sale price on batch reads and ignores it on vet writes', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const staff = await registerUser(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken, { name: 'Fin Farm' });
    await addOrganizationMember(app, owner.accessToken, farm.id, { userId: vet.id, role: 'VETERINARIAN' });
    await addOrganizationMember(app, owner.accessToken, farm.id, { userId: staff.id, role: 'STAFF' });

    const base = `/api/v1/organizations/${farm.id}/poultry/flocks`;
    const created = await request(app)
      .post(base)
      .set(bearer(owner.accessToken))
      .send({ name: 'B1', birdType: 'CHICKEN', birdCount: 100, arrivalDate: '2026-02-01', targetPricePerKg: 4 });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ targetPricePerKg: '4.00', financialsVisible: true });
    const id = created.body.data.id as string;

    for (const who of [vet, staff]) {
      const get = await request(app).get(`${base}/${id}`).set(bearer(who.accessToken));
      expect(get.status).toBe(200);
      expect(get.body.data).toMatchObject({ targetPricePerKg: null, financialsVisible: false });
      const list = await request(app).get(base).set(bearer(who.accessToken));
      expect(list.body.data[0].targetPricePerKg).toBeNull();
    }

    // A vet's attempt to change the price is dropped — the owner still sees 4.
    const vetPatch = await request(app)
      .patch(`${base}/${id}`)
      .set(bearer(vet.accessToken))
      .send({ targetPricePerKg: 999, notes: 'vet note' });
    expect(vetPatch.status).toBe(200);
    const ownerView = await request(app).get(`${base}/${id}`).set(bearer(owner.accessToken));
    expect(ownerView.body.data).toMatchObject({ targetPricePerKg: '4.00', notes: 'vet note' });

    // ADMIN override sees it too.
    const adminView = await request(app).get(`${base}/${id}`).set(bearer(admin.accessToken));
    expect(adminView.body.data.targetPricePerKg).toBe('4.00');
  });
});
