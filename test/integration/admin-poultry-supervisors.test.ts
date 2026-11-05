import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  assignOrganizationSupervisor,
  assignSystemSupervisor,
  bearer,
  createFarm,
  createSheepFarm,
  joinFarm,
  registerAdmin,
  registerApprovedVet,
  registerModerator,
  registerPendingVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const api = (p: string): string => `/api/v1/admin/poultry-supervisors${p}`;

interface LinkRow {
  membershipId: string;
  role: string;
  assignedAt: string;
  veterinarian: { userId: string; firstName: string; email: string };
  farm: { organizationId: string; name: string; ownerUserId: string; subscriptionStatus: string };
}

async function get<T>(
  token: string,
  path: string,
): Promise<{ status: number; data: T; total: number }> {
  const res = await request(app).get(api(path)).set(bearer(token));
  return { status: res.status, data: res.body.data as T, total: res.body.meta?.total as number };
}

describe('Admin — Poultry Supervisors Management', () => {
  it('is ADMIN-only: moderators, system supervisors and vets get 403', async () => {
    const admin = await registerAdmin(app);
    const moderator = await registerModerator(app);
    const orgSup = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, orgSup.id, 'CLINIC');
    const vet = await registerApprovedVet(app);
    for (const token of [moderator.accessToken, orgSup.accessToken, vet.accessToken]) {
      for (const path of ['/summary', '/linked', '/unlinked-farms', '/unlinked-veterinarians']) {
        expect((await request(app).get(api(path)).set(bearer(token))).status).toBe(403);
      }
    }
    expect((await request(app).get(api('/linked'))).status).toBe(401);
    expect((await get(admin.accessToken, '/summary')).status).toBe(200);
  });

  it('partitions vets and poultry farms into linked / unlinked, with the assignment date', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const linkedVet = await registerApprovedVet(app);
    const supervisingVet = await registerApprovedVet(app);
    const freeVet = await registerApprovedVet(app);
    const pendingVet = await registerPendingVet(app);
    const linkedFarm = await createFarm(app, owner.accessToken, admin.accessToken, {
      name: 'مزرعة مرتبطة',
    });
    const freeFarm = await createFarm(app, owner.accessToken, admin.accessToken, {
      name: 'مزرعة بدون طبيب',
    });
    // a sheep farm is not a poultry farm — never listed here
    const sheep = await createSheepFarm(app, owner.accessToken, admin.accessToken);

    const before = Date.now();
    expect((await joinFarm(app, linkedVet.accessToken, linkedFarm.joinCode)).status).toBe(201);
    // an approved vet granted as a farm SUPERVISOR is also a supervising vet
    await assignOrganizationSupervisor(app, owner.accessToken, linkedFarm.id, {
      userId: supervisingVet.id,
      permissions: ['farm.poultry.read'],
    });
    // a vet linked only to a sheep farm is still "unlinked" for poultry
    expect((await joinFarm(app, freeVet.accessToken, sheep.joinCode)).status).toBe(201);

    const linked = await get<LinkRow[]>(admin.accessToken, '/linked');
    expect(linked.status).toBe(200);
    expect(linked.total).toBe(2);
    const byVet = new Map(linked.data.map((l) => [l.veterinarian.userId, l]));
    expect(byVet.get(linkedVet.id)).toMatchObject({
      role: 'VETERINARIAN',
      farm: { organizationId: linkedFarm.id, name: 'مزرعة مرتبطة', ownerUserId: owner.id },
    });
    expect(byVet.get(supervisingVet.id)?.role).toBe('SUPERVISOR');
    const assignedAt = Date.parse(byVet.get(linkedVet.id)!.assignedAt);
    expect(assignedAt).toBeGreaterThanOrEqual(before - 5_000);
    expect(assignedAt).toBeLessThanOrEqual(Date.now() + 5_000);

    const farms = await get<Array<{ organizationId: string }>>(
      admin.accessToken,
      '/unlinked-farms',
    );
    expect(farms.data.map((f) => f.organizationId)).toEqual([freeFarm.id]);

    const vets = await get<Array<{ userId: string }>>(admin.accessToken, '/unlinked-veterinarians');
    const unlinkedIds = vets.data.map((v) => v.userId);
    expect(unlinkedIds).toContain(freeVet.id);
    expect(unlinkedIds).not.toContain(linkedVet.id);
    expect(unlinkedIds).not.toContain(supervisingVet.id);
    expect(unlinkedIds).not.toContain(pendingVet.id); // not an approved veterinarian
    expect(unlinkedIds).not.toContain(owner.id);

    const summary = await get<Record<string, number>>(admin.accessToken, '/summary');
    expect(summary.data).toEqual({
      linked: 2,
      unlinkedFarms: 1,
      unlinkedVeterinarians: vets.total,
    });

    // search narrows each list
    const searched = await get<LinkRow[]>(admin.accessToken, `/linked?search=${linkedVet.email}`);
    expect(searched.data.map((l) => l.veterinarian.userId)).toEqual([linkedVet.id]);
    const farmSearch = await get<unknown[]>(
      admin.accessToken,
      `/unlinked-farms?search=${encodeURIComponent('بدون')}`,
    );
    expect(farmSearch.total).toBe(1);
  });

  it('a vet who leaves is unlinked; re-joining re-links with a NEW assignment date', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await joinFarm(app, vet.accessToken, farm.joinCode);

    const first = await get<LinkRow[]>(admin.accessToken, '/linked');
    expect(first.total).toBe(1);
    // pretend the original assignment was long ago
    await getTestDb()('organization_memberships')
      .where({ id: first.data[0]!.membershipId })
      .update({ assigned_at: new Date('2025-01-01T00:00:00Z') });

    const left = await request(app)
      .post(`/api/v1/organizations/${farm.id}/leave`)
      .set(bearer(vet.accessToken));
    expect(left.status).toBeLessThan(300);

    expect((await get<LinkRow[]>(admin.accessToken, '/linked')).total).toBe(0);
    const unlinkedFarms = await get<Array<{ organizationId: string }>>(
      admin.accessToken,
      '/unlinked-farms',
    );
    expect(unlinkedFarms.data.map((f) => f.organizationId)).toEqual([farm.id]);
    const unlinkedVets = await get<Array<{ userId: string }>>(
      admin.accessToken,
      '/unlinked-veterinarians',
    );
    expect(unlinkedVets.data.map((v) => v.userId)).toContain(vet.id);

    expect((await joinFarm(app, vet.accessToken, farm.joinCode)).status).toBeLessThan(300);
    const again = await get<LinkRow[]>(admin.accessToken, '/linked');
    expect(again.total).toBe(1);
    // same membership row re-activated, but the relationship date is the re-join
    expect(again.data[0]!.membershipId).toBe(first.data[0]!.membershipId);
    expect(Date.parse(again.data[0]!.assignedAt)).toBeGreaterThan(
      Date.parse('2026-01-01T00:00:00Z'),
    );
  });

  it('a deleted (DEACTIVATED) farm drops out of every list and frees its vet', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await joinFarm(app, vet.accessToken, farm.joinCode);
    expect((await get<LinkRow[]>(admin.accessToken, '/linked')).total).toBe(1);

    const del = await request(app)
      .delete(`/api/v1/admin/organizations/${farm.id}`)
      .set(bearer(admin.accessToken))
      .send({});
    expect(del.status).toBe(200);

    expect((await get<LinkRow[]>(admin.accessToken, '/linked')).total).toBe(0);
    expect((await get<unknown[]>(admin.accessToken, '/unlinked-farms')).total).toBe(0);
    const vets = await get<Array<{ userId: string }>>(admin.accessToken, '/unlinked-veterinarians');
    expect(vets.data.map((v) => v.userId)).toContain(vet.id);
  });
});
