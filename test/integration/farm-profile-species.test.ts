import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createCattleFarm,
  createFarm,
  createSheepFarm,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const profile = (orgId: string) => `/api/v1/organizations/${orgId}/farm/profile`;

describe('farm profile edit is species-correct (sheep / cattle ≠ poultry)', () => {
  it('a sheep farm edits its own fields and rejects poultry fields', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const farm = await createSheepFarm(app, owner.accessToken, admin.accessToken);

    const ok = await request(app)
      .patch(profile(farm.id))
      .set(bearer(owner.accessToken))
      .send({ sheepProductionType: 'DAIRY', currentSheepCount: 120, address: 'Farm road 1' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({
      farmSpecies: 'SHEEP',
      sheepProductionType: 'DAIRY',
      currentSheepCount: 120,
      poultryProductionType: null,
    });

    const poultry = await request(app)
      .patch(profile(farm.id))
      .set(bearer(owner.accessToken))
      .send({ poultryProductionType: 'BROILER', currentBirdCount: 10 });
    expect(poultry.status).toBe(400);
    const cattle = await request(app)
      .patch(profile(farm.id))
      .set(bearer(owner.accessToken))
      .send({ cattleProductionType: 'BEEF' });
    expect(cattle.status).toBe(400);

    const read = await request(app).get(profile(farm.id)).set(bearer(owner.accessToken));
    expect(read.body.data.poultryProductionType).toBeNull();
  });

  it('a cattle farm edits cattle fields; a poultry farm keeps its poultry fields', async () => {
    const admin = await registerAdmin(app);
    const cattleOwner = await registerUser(app);
    const cattle = await createCattleFarm(app, cattleOwner.accessToken, admin.accessToken);
    const res = await request(app)
      .patch(profile(cattle.id))
      .set(bearer(cattleOwner.accessToken))
      .send({ cattleProductionType: 'BEEF', currentCattleCount: 40 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      farmSpecies: 'CATTLE',
      cattleProductionType: 'BEEF',
      currentCattleCount: 40,
    });

    const poultryOwner = await registerApprovedVet(app);
    const poultry = await createFarm(app, poultryOwner.accessToken, admin.accessToken);
    const p = await request(app)
      .patch(profile(poultry.id))
      .set(bearer(poultryOwner.accessToken))
      .send({ poultryProductionType: 'LAYER', currentBirdCount: 900 });
    expect(p.status).toBe(200);
    const bad = await request(app)
      .patch(profile(poultry.id))
      .set(bearer(poultryOwner.accessToken))
      .send({ sheepProductionType: 'MEAT' });
    expect(bad.status).toBe(400);
  });
});
