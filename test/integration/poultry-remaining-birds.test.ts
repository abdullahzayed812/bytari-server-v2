import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createFarm,
  createPoultryFlock,
  registerAdmin,
  registerApprovedVet,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const flocks = (orgId: string, id?: string): string =>
  `/api/v1/organizations/${orgId}/poultry/flocks${id ? `/${id}` : ''}`;

async function setup() {
  const admin = await registerAdmin(app);
  const owner = await registerApprovedVet(app);
  const farm = await createFarm(app, owner.accessToken, admin.accessToken);
  const flock = await createPoultryFlock(app, owner.accessToken, farm.id, { birdCount: 1000 });
  return { owner, farm, flock };
}

async function addDailyRecord(
  token: string,
  orgId: string,
  flockId: string,
  mortalityCount: number,
): Promise<string> {
  const res = await request(app)
    .post(`${flocks(orgId, flockId)}/daily-records`)
    .set(bearer(token))
    .send({ feedKg: 10, waterLiters: 20, mortalityCount });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

describe('poultry batch — remaining bird count', () => {
  it('a new flock starts with currentBirdCount = birdCount and no mortality', async () => {
    const { owner, farm, flock } = await setup();
    const res = await request(app).get(flocks(farm.id, flock.id)).set(bearer(owner.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      birdCount: 1000,
      initialBirdCount: 1000,
      totalMortality: 0,
      currentBirdCount: 1000,
    });
  });

  it('recorded deaths reduce currentBirdCount on the flock, the list and the batch summary alike', async () => {
    const { owner, farm, flock } = await setup();
    const recordId = await addDailyRecord(owner.accessToken, farm.id, flock.id, 40);

    const one = await request(app).get(flocks(farm.id, flock.id)).set(bearer(owner.accessToken));
    expect(one.body.data).toMatchObject({ totalMortality: 40, currentBirdCount: 960 });

    const list = await request(app).get(flocks(farm.id)).set(bearer(owner.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toMatchObject({ id: flock.id, currentBirdCount: 960 });

    const summary = await request(app)
      .get(`${flocks(farm.id, flock.id)}/summary`)
      .set(bearer(owner.accessToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data).toMatchObject({ totalMortality: 40, currentBirdCount: 960 });

    // Correcting the daily record's mortality is reflected immediately.
    const patch = await request(app)
      .patch(`${flocks(farm.id, flock.id)}/daily-records/${recordId}`)
      .set(bearer(owner.accessToken))
      .send({ mortalityCount: 15 });
    expect(patch.status).toBe(200);
    const after = await request(app).get(flocks(farm.id, flock.id)).set(bearer(owner.accessToken));
    expect(after.body.data).toMatchObject({ totalMortality: 15, currentBirdCount: 985 });

    // Deleting the record gives the birds back.
    const del = await request(app)
      .delete(`${flocks(farm.id, flock.id)}/daily-records/${recordId}`)
      .set(bearer(owner.accessToken));
    expect(del.status).toBe(200);
    const restored = await request(app)
      .get(flocks(farm.id, flock.id))
      .set(bearer(owner.accessToken));
    expect(restored.body.data).toMatchObject({ totalMortality: 0, currentBirdCount: 1000 });
  });

  it('correcting the entered bird count re-bases the remaining count; the update response carries it', async () => {
    const { owner, farm, flock } = await setup();
    await addDailyRecord(owner.accessToken, farm.id, flock.id, 100);

    const res = await request(app)
      .patch(flocks(farm.id, flock.id))
      .set(bearer(owner.accessToken))
      .send({ birdCount: 1200 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      birdCount: 1200,
      initialBirdCount: 1200,
      totalMortality: 100,
      currentBirdCount: 1100,
    });
  });
});
