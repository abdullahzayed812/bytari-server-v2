import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { approveOrganization, bearer, registerAdmin, registerUser } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const validBody = {
  name: 'مزرعة النور للدواجن',
  location: 'بغداد - الدورة',
  governorate: 'بغداد',
  poultryProductionType: 'BROILER',
  description: 'حقل دواجن لاحم',
  address: 'شارع 14، قرب الجسر',
  capacity: 10000,
  currentBirdCount: 8500,
  contactName: 'زهير الراوي',
  contactPhone: '+9647721300484',
  contactEmail: 'owner@example.test',
};

describe('POST /organizations/farms — Add Poultry Farm', () => {
  it('a plain Pet Owner creates a farm: FARM org (PENDING) + farm_details + OWNER membership', async () => {
    const user = await registerUser(app);

    const res = await request(app)
      .post('/api/v1/organizations/farms')
      .set(bearer(user.accessToken))
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'FARM',
      name: 'مزرعة النور للدواجن',
      status: 'PENDING',
      ownerUserId: user.id,
    });
    const orgId = res.body.data.id as string;
    // join code is generated for FARM
    expect(typeof res.body.data.details.joinCode).toBe('string');

    // the creator is an ACTIVE OWNER member — via the existing membership model
    const db = getTestDb();
    const membership = (await db('organization_memberships as m')
      .join('organization_roles as r', 'r.id', 'm.organization_role_id')
      .where({ 'm.organization_id': orgId, 'm.user_id': user.id })
      .select('m.status', 'r.key as roleKey')
      .first()) as { status: string; roleKey: string } | undefined;
    expect(membership).toMatchObject({ status: 'ACTIVE', roleKey: 'OWNER' });

    // farm_details carries every submitted field
    const details = (await db('farm_details').where({ organization_id: orgId }).first()) as
      Record<string, unknown> | undefined;
    expect(details).toMatchObject({
      location: 'بغداد - الدورة',
      governorate: 'بغداد',
      poultry_production_type: 'BROILER',
      capacity: 10000,
      current_bird_count: 8500,
      contact_name: 'زهير الراوي',
      contact_phone: '+9647721300484',
      contact_email: 'owner@example.test',
      address: 'شارع 14، قرب الجسر',
    });
  });

  it('the new farm appears in the creator’s "my organizations" list', async () => {
    const user = await registerUser(app);
    const created = await request(app)
      .post('/api/v1/organizations/farms')
      .set(bearer(user.accessToken))
      .send(validBody)
      .expect(201);

    const mine = await request(app).get('/api/v1/organizations').set(bearer(user.accessToken));
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((o: { id: string }) => o.id)).toContain(created.body.data.id);
    expect(mine.body.data[0]).toMatchObject({ type: 'FARM', myRole: 'OWNER' });
  });

  it('after admin approval the OWNER can read the farm profile (fields round-trip)', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    const created = await request(app)
      .post('/api/v1/organizations/farms')
      .set(bearer(user.accessToken))
      .send(validBody)
      .expect(201);
    const orgId = created.body.data.id as string;

    // a PENDING farm is not yet operable by the non-admin OWNER (platform rule)
    const early = await request(app)
      .get(`/api/v1/organizations/${orgId}/farm/profile`)
      .set(bearer(user.accessToken));
    expect(early.status).toBe(403);

    await approveOrganization(app, admin.accessToken, orgId);

    const profile = await request(app)
      .get(`/api/v1/organizations/${orgId}/farm/profile`)
      .set(bearer(user.accessToken));
    expect(profile.status).toBe(200);
    expect(profile.body.data).toMatchObject({
      location: 'بغداد - الدورة',
      governorate: 'بغداد',
      capacity: 10000,
      currentBirdCount: 8500,
      poultryProductionType: 'BROILER',
      contactName: 'زهير الراوي',
    });
  });

  it('rejects a missing required field (422) and creates no organization', async () => {
    const user = await registerUser(app);
    const db = getTestDb();
    const before = Number(
      (await db('organizations').count<{ count: string }>({ count: '*' }).first())?.count ?? 0,
    );

    for (const bad of [
      { ...validBody, name: undefined },
      { ...validBody, location: undefined },
      { ...validBody, governorate: undefined },
      { ...validBody, poultryProductionType: undefined },
      { ...validBody, poultryProductionType: 'DRAGON' },
      { ...validBody, contactEmail: 'not-an-email' },
    ]) {
      const res = await request(app)
        .post('/api/v1/organizations/farms')
        .set(bearer(user.accessToken))
        .send(bad);
      expect(res.status).toBe(422);
    }

    const after = Number(
      (await db('organizations').count<{ count: string }>({ count: '*' }).first())?.count ?? 0,
    );
    expect(after).toBe(before);
  });

  it('requires authentication (401)', async () => {
    const res = await request(app).post('/api/v1/organizations/farms').send(validBody);
    expect(res.status).toBe(401);
  });

  it('a suspended account cannot create a farm (403)', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    await request(app)
      .post(`/api/v1/admin/users/${user.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'test' });

    const res = await request(app)
      .post('/api/v1/organizations/farms')
      .set(bearer(user.accessToken))
      .send(validBody);
    expect([401, 403]).toContain(res.status);
  });
});
