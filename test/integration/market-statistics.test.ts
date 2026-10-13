import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createFarm,
  createOrganization,
  createPoultryFlock,
  registerAdmin,
  registerApprovedTrader,
  registerUser,
  seedDailyRecordRow,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

/**
 * A farm in `governorate` with one ACTIVE batch of `birds` birds. The
 * registration-time `current_bird_count` is set to a decoy so a test fails if
 * the statistics ever read it again.
 */
async function farmWithBirds(
  ownerToken: string,
  adminToken: string,
  governorate: string,
  birds: number,
): Promise<{ farmId: string; flockId: string }> {
  const farm = await createFarm(app, ownerToken, adminToken);
  await getTestDb()('farm_details')
    .where({ organization_id: farm.id })
    .update({ governorate, current_bird_count: 999_999 });
  const flock = await createPoultryFlock(app, ownerToken, farm.id, { birdCount: birds });
  return { farmId: farm.id, flockId: flock.id };
}

async function stats(token: string) {
  const res = await request(app).get('/api/v1/poultry-market/statistics').set(bearer(token));
  expect(res.status).toBe(200);
  return res.body.data as {
    totalFarms: number;
    totalBirds: number;
    byGovernorate: Array<{ governorate: string; farmCount: number; totalBirds: number }>;
  };
}

const gov = (data: Awaited<ReturnType<typeof stats>>, name: string) =>
  data.byGovernorate.find((g) => g.governorate === name);

describe('market statistics (governorate distribution)', () => {
  it('aggregates ACTIVE FARM organizations by governorate; excludes non-FARM/non-ACTIVE', async () => {
    const owner = await registerUser(app);
    const admin = await registerAdmin(app);

    await farmWithBirds(owner.accessToken, admin.accessToken, 'نينوى', 2000);
    await farmWithBirds(owner.accessToken, admin.accessToken, 'نينوى', 3000);
    await farmWithBirds(owner.accessToken, admin.accessToken, 'بغداد', 1500);

    // A non-FARM organization must never contribute to the aggregate.
    await createOrganization(app, owner.accessToken, { type: 'VETERINARY_OFFICE' });

    const trader = await registerApprovedTrader(app);
    const data = await stats(trader.accessToken);

    expect(gov(data, 'نينوى')).toMatchObject({ farmCount: 2, totalBirds: 5000 });
    expect(gov(data, 'بغداد')).toMatchObject({ farmCount: 1, totalBirds: 1500 });
    expect(data.totalFarms).toBe(3);
    expect(data.totalBirds).toBe(6500);
  });

  it('counts birds REMAINING in active batches: mortality reduces it, closed batches and the registration count do not count', async () => {
    const owner = await registerUser(app);
    const admin = await registerAdmin(app);
    const { farmId, flockId } = await farmWithBirds(
      owner.accessToken,
      admin.accessToken,
      'أربيل',
      1000,
    );
    // Deaths across several daily records (one farm, one batch — must not be double-counted).
    await seedDailyRecordRow('poultry', flockId, farmId, '2026-03-01', { mortalityCount: 30 });
    await seedDailyRecordRow('poultry', flockId, farmId, '2026-03-02', { mortalityCount: 20 });
    // A second ACTIVE batch on the same farm.
    const second = await createPoultryFlock(app, owner.accessToken, farmId, { birdCount: 400 });
    await seedDailyRecordRow('poultry', second.id, farmId, '2026-03-01', { mortalityCount: 5 });
    // A CLOSED (sold) batch contributes nothing.
    const sold = await createPoultryFlock(app, owner.accessToken, farmId, { birdCount: 7000 });
    await getTestDb()('poultry_flocks').where({ id: sold.id }).update({ status: 'CLOSED' });
    // A farm with no batches still counts as a farm, with 0 birds.
    const empty = await createFarm(app, owner.accessToken, admin.accessToken);
    await getTestDb()('farm_details')
      .where({ organization_id: empty.id })
      .update({ governorate: 'أربيل', current_bird_count: 5000 });

    const data = await stats(admin.accessToken);
    // (1000 − 50) + (400 − 5) = 1345
    expect(gov(data, 'أربيل')).toMatchObject({ farmCount: 2, totalBirds: 1345 });
    expect(data.totalBirds).toBe(1345);
  });

  it('remaining birds never go below zero for a batch', async () => {
    const owner = await registerUser(app);
    const admin = await registerAdmin(app);
    const { farmId, flockId } = await farmWithBirds(
      owner.accessToken,
      admin.accessToken,
      'دهوك',
      10,
    );
    await seedDailyRecordRow('poultry', flockId, farmId, '2026-03-01', { mortalityCount: 25 });
    const data = await stats(admin.accessToken);
    expect(gov(data, 'دهوك')).toMatchObject({ farmCount: 1, totalBirds: 0 });
  });

  it('requires an approved trader or admin (403 for a plain user)', async () => {
    const u = await registerUser(app);
    const res = await request(app)
      .get('/api/v1/poultry-market/statistics')
      .set(bearer(u.accessToken));
    expect(res.status).toBe(403);
  });

  it('an admin can read the summary without being a trader', async () => {
    const admin = await registerAdmin(app);
    const res = await request(app)
      .get('/api/v1/poultry-market/statistics')
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
  });
});
