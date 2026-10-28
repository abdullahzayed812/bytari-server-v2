import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createCattleFarm,
  createFarm,
  createSheepFarm,
  registerAdmin,
  registerApprovedVet,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const poultryBody = (purchasePricePerKg: unknown) => ({
  name: 'Batch P',
  birdType: 'CHICKEN',
  birdCount: 1000,
  arrivalDate: '2026-02-01',
  purchasePricePerKg,
});

describe('batch purchase price per kilogram', () => {
  it('poultry: any non-negative price is stored as entered (no digit limit), editable, and shown in the batch summary', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    const base = `/api/v1/organizations/${farm.id}/poultry/flocks`;

    const created = await request(app)
      .post(base)
      .set(bearer(owner.accessToken))
      .send(poultryBody(123456789.75));
    expect(created.status).toBe(201);
    expect(created.body.data.purchasePricePerKg).toBe('123456789.75');

    const edited = await request(app)
      .patch(`${base}/${created.body.data.id}`)
      .set(bearer(owner.accessToken))
      .send({ purchasePricePerKg: 2750.5 });
    expect(edited.status).toBe(200);
    expect(edited.body.data.purchasePricePerKg).toBe('2750.50');

    const summary = await request(app)
      .get(`${base}/${created.body.data.id}/summary`)
      .set(bearer(owner.accessToken));
    expect(summary.body.data.purchasePricePerKg).toBe('2750.50');

    for (const bad of [-1, 'abc', 2_000_000_000]) {
      const res = await request(app)
        .post(base)
        .set(bearer(owner.accessToken))
        .send(poultryBody(bad));
      expect(res.status).toBe(422);
    }
  });

  it('poultry: the purchase price is financial data — hidden from, and not settable by, a farm veterinarian', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    const vet = await registerApprovedVet(app);
    await addOrganizationMember(app, owner.accessToken, farm.id, {
      userId: vet.id,
      role: 'VETERINARIAN',
    });
    const base = `/api/v1/organizations/${farm.id}/poultry/flocks`;
    const created = await request(app)
      .post(base)
      .set(bearer(owner.accessToken))
      .send(poultryBody(1500));
    const id = created.body.data.id as string;

    const seen = await request(app).get(`${base}/${id}`).set(bearer(vet.accessToken));
    expect(seen.status).toBe(200);
    expect(seen.body.data.purchasePricePerKg).toBeNull();

    await request(app)
      .patch(`${base}/${id}`)
      .set(bearer(vet.accessToken))
      .send({ name: 'Renamed', purchasePricePerKg: 1 });
    const after = await request(app).get(`${base}/${id}`).set(bearer(owner.accessToken));
    expect(after.body.data.purchasePricePerKg).toBe('1500.00');
  });

  it('sheep and cattle batches store the purchase price too', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const sheepFarm = await createSheepFarm(app, owner.accessToken, admin.accessToken);
    const cattleFarm = await createCattleFarm(app, owner.accessToken, admin.accessToken);
    const sheep = await request(app)
      .post(`/api/v1/organizations/${sheepFarm.id}/sheep/batches`)
      .set(bearer(owner.accessToken))
      .send({ name: 'S', headCount: 10, arrivalDate: '2026-02-01', purchasePricePerKg: 9800.25 });
    expect(sheep.status).toBe(201);
    expect(sheep.body.data.purchasePricePerKg).toBe('9800.25');
    const cattle = await request(app)
      .post(`/api/v1/organizations/${cattleFarm.id}/cattle/batches`)
      .set(bearer(owner.accessToken))
      .send({ name: 'C', headCount: 5, arrivalDate: '2026-02-01', purchasePricePerKg: 12000 });
    expect(cattle.status).toBe(201);
    expect(cattle.body.data.purchasePricePerKg).toBe('12000.00');
  });
});
