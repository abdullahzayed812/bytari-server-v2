import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createCattleFarm,
  createFarm,
  createSheepBatch,
  createSheepFarm,
  registerAdmin,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const adminApi = (p: string): string => `/api/v1/admin/organizations${p}`;

describe('Admin farm management — complete farm file, per-species lists, delete', () => {
  it('lists carry the farm profile + counts; SHEEP / CATTLE / POULTRY lists are separate', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const poultry = await createFarm(app, owner.accessToken, admin.accessToken, {
      name: 'Poultry A',
    });
    const sheep = await createSheepFarm(app, owner.accessToken, admin.accessToken, {
      name: 'Sheep A',
      governorate: 'ديالى',
      location: 'بعقوبة',
    });
    const cattle = await createCattleFarm(app, owner.accessToken, admin.accessToken, {
      name: 'Cattle A',
    });
    await createSheepBatch(app, owner.accessToken, sheep.id, {});

    const ids = async (group: string): Promise<string[]> => {
      const res = await request(app)
        .get(adminApi(`/farms?speciesGroup=${group}`))
        .set(bearer(admin.accessToken));
      expect(res.status).toBe(200);
      return (res.body.data as { organizationId: string }[]).map((f) => f.organizationId);
    };
    expect(await ids('POULTRY')).toEqual([poultry.id]);
    expect(await ids('SHEEP')).toEqual([sheep.id]);
    expect(await ids('CATTLE')).toEqual([cattle.id]);
    expect((await ids('LIVESTOCK')).sort()).toEqual([sheep.id, cattle.id].sort());

    const list = await request(app)
      .get(adminApi('/farms?speciesGroup=SHEEP'))
      .set(bearer(admin.accessToken));
    expect(list.body.data[0]).toMatchObject({
      farmSpecies: 'SHEEP',
      governorate: 'ديالى',
      location: 'بعقوبة',
      sheepBatchCount: 1,
      cattleBatchCount: 0,
      ownerEmail: expect.any(String),
    });
    expect(list.body.data[0].memberCount).toBeGreaterThanOrEqual(1);
    expect(list.body.data[0].imageKey).toBeUndefined();

    const detail = await request(app)
      .get(adminApi(`/${sheep.id}`))
      .set(bearer(admin.accessToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.farm).toMatchObject({
      farmSpecies: 'SHEEP',
      governorate: 'ديالى',
      location: 'بعقوبة',
    });
  });

  it('admin deletes a farm (soft delete) — owner cannot; it leaves the default list', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const farm = await createCattleFarm(app, owner.accessToken, admin.accessToken, {
      name: 'Cattle B',
    });

    const denied = await request(app)
      .delete(adminApi(`/${farm.id}`))
      .set(bearer(owner.accessToken))
      .send({});
    expect(denied.status).toBe(403);

    const del = await request(app)
      .delete(adminApi(`/${farm.id}`))
      .set(bearer(admin.accessToken))
      .send({});
    expect(del.status).toBe(200);
    expect(del.body.data.status).toBe('DEACTIVATED');

    const list = await request(app)
      .get(adminApi('/farms?speciesGroup=CATTLE'))
      .set(bearer(admin.accessToken));
    expect(list.body.data).toHaveLength(0);
    const deleted = await request(app)
      .get(adminApi('/farms?speciesGroup=CATTLE&status=DEACTIVATED'))
      .set(bearer(admin.accessToken));
    expect(deleted.body.data.map((f: { organizationId: string }) => f.organizationId)).toEqual([
      farm.id,
    ]);

    // the owner can no longer operate the farm
    const ops = await request(app)
      .get(`/api/v1/organizations/${farm.id}/cattle/batches`)
      .set(bearer(owner.accessToken));
    expect(ops.status).toBeGreaterThanOrEqual(400);
  });
});
