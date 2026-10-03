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

const ids = (res: request.Response): string[] =>
  (res.body.data as { id: string }[]).map((o) => o.id).sort();

describe('GET /organizations?scope=farm_section — supervised farms stay out of the farm sections', () => {
  it('a supervising vet sees the farm only in "My Organizations"; owned farms + staff farms stay', async () => {
    const admin = await registerAdmin(app);
    const farmer = await registerUser(app);
    const vet = await registerApprovedVet(app);
    const employee = await registerUser(app);

    const supervised = await createFarm(app, farmer.accessToken, admin.accessToken, {
      name: 'مزرعة الإشراف',
    });
    await addOrganizationMember(app, farmer.accessToken, supervised.id, {
      userId: vet.id,
      role: 'VETERINARIAN',
    });
    await addOrganizationMember(app, farmer.accessToken, supervised.id, {
      userId: employee.id,
      role: 'STAFF',
    });
    const owned = await createFarm(app, vet.accessToken, admin.accessToken, {
      name: 'مزرعتي',
    });

    const all = await request(app).get('/api/v1/organizations').set(bearer(vet.accessToken));
    expect(all.status).toBe(200);
    expect(ids(all)).toEqual([owned.id, supervised.id].sort());

    const section = await request(app)
      .get('/api/v1/organizations?scope=farm_section')
      .set(bearer(vet.accessToken));
    expect(section.status).toBe(200);
    expect(ids(section)).toEqual([owned.id]);
    expect(section.body.meta.total).toBe(1);

    // the farm's employee (STAFF) still gets it in the section — they run the dashboard
    const staff = await request(app)
      .get('/api/v1/organizations?scope=farm_section')
      .set(bearer(employee.accessToken));
    expect(ids(staff)).toEqual([supervised.id]);

    const bad = await request(app)
      .get('/api/v1/organizations?scope=nope')
      .set(bearer(vet.accessToken));
    expect(bad.status).toBe(422);
  });
});
