import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createFarm,
  createOrganization,
  registerAdmin,
  registerApprovedTrader,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function setFarmStats(
  organizationId: string,
  governorate: string,
  currentBirdCount: number,
): Promise<void> {
  await getTestDb()('farm_details')
    .where({ organization_id: organizationId })
    .update({ governorate, current_bird_count: currentBirdCount });
}

describe('market statistics (governorate distribution)', () => {
  it('aggregates ACTIVE FARM organizations by governorate; excludes non-FARM/non-ACTIVE', async () => {
    const owner = await registerUser(app);
    const admin = await registerAdmin(app);

    const farmA = await createFarm(app, owner.accessToken, admin.accessToken);
    await setFarmStats(farmA.id, 'نينوى', 2000);
    const farmB = await createFarm(app, owner.accessToken, admin.accessToken);
    await setFarmStats(farmB.id, 'نينوى', 3000);
    const farmC = await createFarm(app, owner.accessToken, admin.accessToken);
    await setFarmStats(farmC.id, 'بغداد', 1500);

    // A non-FARM organization must never contribute to the aggregate.
    await createOrganization(app, owner.accessToken, { type: 'VETERINARY_OFFICE' });

    const trader = await registerApprovedTrader(app);
    const res = await request(app)
      .get('/api/v1/poultry-market/statistics')
      .set(bearer(trader.accessToken));
    expect(res.status).toBe(200);

    const ninewa = res.body.data.byGovernorate.find(
      (g: { governorate: string }) => g.governorate === 'نينوى',
    );
    expect(ninewa.farmCount).toBe(2);
    expect(ninewa.totalBirds).toBe(5000);

    const baghdad = res.body.data.byGovernorate.find(
      (g: { governorate: string }) => g.governorate === 'بغداد',
    );
    expect(baghdad.farmCount).toBe(1);
    expect(baghdad.totalBirds).toBe(1500);

    expect(res.body.data.totalFarms).toBe(3);
    expect(res.body.data.totalBirds).toBe(6500);
  });

  it('requires an approved trader or admin (403 for a plain user)', async () => {
    const u = await registerUser(app);
    const res = await request(app).get('/api/v1/poultry-market/statistics').set(bearer(u.accessToken));
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
