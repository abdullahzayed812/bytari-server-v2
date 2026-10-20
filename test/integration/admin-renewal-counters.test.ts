import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  assignSystemSupervisor,
  bearer,
  createActiveOrganization,
  createFarm,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  requestFarmRenewal,
  setFarmSubscriptionAsAdmin,
} from '../helpers/factories.js';

const { app } = buildTestApp();
const API = '/api/v1';

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const EXPIRED = { startDate: '2020-01-01', endDate: '2020-06-01' };

type Card = { id: string; pendingRenewals?: number };
async function cards(token: string): Promise<Map<string, Card>> {
  const res = await request(app).get(`${API}/admin/dashboard/summary`).set(bearer(token));
  expect(res.status).toBe(200);
  return new Map((res.body.data.cards as Card[]).map((c) => [c.id, c]));
}

/** The admin farms screen's "طلبات التجديد" tab for one species section. */
async function farmRenewalTab(token: string, speciesGroup: 'POULTRY' | 'LIVESTOCK') {
  const res = await request(app)
    .get(`${API}/admin/organizations/farms`)
    .query({ speciesGroup, renewal: 'PENDING' })
    .set(bearer(token));
  expect(res.status).toBe(200);
  return {
    total: res.body.meta.total as number,
    ids: (res.body.data as Array<{ organizationId: string }>).map((f) => f.organizationId).sort(),
  };
}

async function pendingRenewalOf(farmId: string): Promise<string> {
  const row = await getTestDb()('farm_subscription_renewal_requests')
    .where({ organization_id: farmId, status: 'PENDING' })
    .first();
  return row.id as string;
}

describe('ManagementScreen renewal counters', () => {
  it('poultry farms: counter = the renewals tab = the PENDING rows, and follows approve / reject / delete', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const t = admin.accessToken;
    const [a, b, c] = await Promise.all([
      createFarm(app, owner.accessToken, t, { name: 'مزرعة أ' }),
      createFarm(app, owner.accessToken, t, { name: 'مزرعة ب' }),
      createFarm(app, owner.accessToken, t, { name: 'مزرعة ج' }),
    ]);
    for (const farm of [a, b, c]) {
      await setFarmSubscriptionAsAdmin(app, t, farm.id, EXPIRED);
    }
    for (const farm of [a, b]) {
      expect((await requestFarmRenewal(app, owner.accessToken, farm.id)).status).toBe(201);
    }

    const dbPending = await getTestDb()('farm_subscription_renewal_requests')
      .where({ status: 'PENDING' })
      .count<{ count: string }>({ count: '*' })
      .first();
    expect(Number(dbPending?.count)).toBe(2);

    let summary = await cards(t);
    expect(summary.get('poultry')?.pendingRenewals).toBe(2);
    expect(summary.get('livestock')?.pendingRenewals).toBe(0);
    // farm requests never leak into the clinic / office counters
    expect(summary.get('clinics')?.pendingRenewals).toBe(0);
    expect(summary.get('offices')?.pendingRenewals).toBe(0);
    expect(await farmRenewalTab(t, 'POULTRY')).toEqual({ total: 2, ids: [a.id, b.id].sort() });

    await request(app)
      .post(
        `${API}/admin/organizations/${a.id}/subscription-renewals/${await pendingRenewalOf(a.id)}/approve`,
      )
      .set(bearer(t))
      .send({ startDate: '2026-06-01', endDate: '2099-06-01' })
      .expect(200);
    summary = await cards(t);
    expect(summary.get('poultry')?.pendingRenewals).toBe(1);
    expect(await farmRenewalTab(t, 'POULTRY')).toEqual({ total: 1, ids: [b.id] });

    await request(app)
      .post(
        `${API}/admin/organizations/${b.id}/subscription-renewals/${await pendingRenewalOf(b.id)}/reject`,
      )
      .set(bearer(t))
      .send({ reason: 'لم يتم الدفع' })
      .expect(200);
    expect((await cards(t)).get('poultry')?.pendingRenewals).toBe(0);

    // A request of an admin-deleted (DEACTIVATED) farm is not an open task anywhere.
    expect((await requestFarmRenewal(app, owner.accessToken, c.id)).status).toBe(201);
    expect((await cards(t)).get('poultry')?.pendingRenewals).toBe(1);
    await getTestDb()('organizations').where({ id: c.id }).update({ status: 'DEACTIVATED' });
    expect((await cards(t)).get('poultry')?.pendingRenewals).toBe(0);
    expect((await farmRenewalTab(t, 'POULTRY')).total).toBe(0);
    const queue = await request(app)
      .get(`${API}/admin/organizations/subscription-renewals/pending`)
      .set(bearer(t));
    expect(queue.body.meta.total).toBe(0);
  });

  it('clinics / offices: each counter equals its own type-scoped queue', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const t = admin.accessToken;
    const clinics = await Promise.all(
      [1, 2].map((i) =>
        createActiveOrganization(app, owner.accessToken, t, { type: 'CLINIC', name: `عيادة ${i}` }),
      ),
    );
    const office = await createActiveOrganization(app, owner.accessToken, t, {
      type: 'VETERINARY_OFFICE',
      name: 'مكتب',
    });
    for (const org of [...clinics, office]) {
      await setFarmSubscriptionAsAdmin(app, t, org.id, EXPIRED);
      await request(app)
        .post(`${API}/organizations/${org.id}/subscription-renewals`)
        .set(bearer(owner.accessToken))
        .send({})
        .expect(201);
    }
    const summary = await cards(t);
    for (const [cardId, type] of [
      ['clinics', 'CLINIC'],
      ['offices', 'VETERINARY_OFFICE'],
    ] as const) {
      const queue = await request(app)
        .get(`${API}/admin/organizations/subscription-renewals/pending`)
        .query({ type })
        .set(bearer(t));
      expect(summary.get(cardId)?.pendingRenewals).toBe(queue.body.meta.total);
    }
    expect(summary.get('clinics')?.pendingRenewals).toBe(2);
    expect(summary.get('offices')?.pendingRenewals).toBe(1);
  });

  it('a supervisor only gets the counters of queues they may open', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, sup.id, 'CLINIC');
    const summary = await cards(sup.accessToken);
    expect(summary.get('clinics')?.pendingRenewals).toBe(0);
    expect(summary.get('offices')?.pendingRenewals).toBe(0);
    // no FARM organization access → the farm counters are omitted, not 0
    expect(summary.get('poultry')).not.toHaveProperty('pendingRenewals');
    expect(summary.get('livestock')).not.toHaveProperty('pendingRenewals');
    const farmsTab = await request(app)
      .get(`${API}/admin/organizations/farms`)
      .query({ speciesGroup: 'POULTRY', renewal: 'PENDING' })
      .set(bearer(sup.accessToken));
    expect(farmsTab.status).toBe(403);
  });
});
