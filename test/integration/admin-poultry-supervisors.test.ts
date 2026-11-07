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
  listNotifications,
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

interface Link {
  membershipId: string;
  role: string;
  assignedAt: string;
  supervisionType: string | null;
  notes: string | null;
}
interface LinkedFarmRow {
  farm: { organizationId: string; name: string; ownerUserId: string; governorate: string | null };
  links: Array<Link & { veterinarian: { userId: string; email: string } }>;
}
interface VetRow {
  veterinarian: { userId: string };
  links: Array<Link & { farm: { organizationId: string; name: string } }>;
}

async function get<T>(
  token: string,
  path: string,
): Promise<{ status: number; data: T; total: number }> {
  const res = await request(app).get(api(path)).set(bearer(token));
  return { status: res.status, data: res.body.data as T, total: res.body.meta?.total as number };
}

const today = (): string => new Date().toISOString().slice(0, 10);

function link(token: string, body: Record<string, unknown>): Promise<request.Response> {
  return request(app)
    .post(api('/links'))
    .set(bearer(token))
    .send({ supervisionType: 'WEEKLY', startDate: '2026-1-15', ...body });
}

describe('Admin — Poultry Supervisors Management (reads)', () => {
  it('needs poultry_supervision.manage: moderators, other supervisors and vets get 403', async () => {
    const admin = await registerAdmin(app);
    const moderator = await registerModerator(app);
    const orgSup = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, orgSup.id, 'CLINIC');
    const vet = await registerApprovedVet(app);
    for (const token of [moderator.accessToken, orgSup.accessToken, vet.accessToken]) {
      for (const path of ['/summary', '/linked-farms', '/unlinked-farms', '/veterinarians']) {
        expect((await request(app).get(api(path)).set(bearer(token))).status).toBe(403);
      }
      expect(
        (await link(token, { organizationId: vet.id, veterinarianUserId: vet.id })).status,
      ).toBe(403);
    }
    expect((await request(app).get(api('/linked-farms'))).status).toBe(401);
    expect((await get(admin.accessToken, '/summary')).status).toBe(200);
  });

  it('a POULTRY_SUPERVISION supervisor manages links but cannot open full vet / farm profiles', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, sup.id, 'POULTRY_SUPERVISION');
    const owner = await registerUser(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    const vet = await registerApprovedVet(app);

    for (const path of ['/summary', '/linked-farms', '/unlinked-farms', '/veterinarians']) {
      expect((await get(sup.accessToken, path)).status).toBe(200);
    }
    const created = await link(sup.accessToken, {
      organizationId: farm.id,
      veterinarianUserId: vet.id,
    });
    expect(created.status).toBe(201);
    const linked = await get<LinkedFarmRow[]>(sup.accessToken, '/linked-farms');
    expect(linked.data.map((r) => r.farm.organizationId)).toEqual([farm.id]);
    const membershipId = linked.data[0]!.links[0]!.membershipId;

    // The full profiles stay behind their own keys — the domain grants none of them.
    for (const path of [
      `/api/v1/admin/users/${vet.id}`,
      `/api/v1/admin/organizations/${farm.id}`,
    ]) {
      expect((await request(app).get(path).set(bearer(sup.accessToken))).status).toBe(403);
      expect((await request(app).get(path).set(bearer(admin.accessToken))).status).toBe(200);
    }

    expect(
      (
        await request(app)
          .delete(api(`/links/${membershipId}`))
          .set(bearer(sup.accessToken))
      ).status,
    ).toBe(200);
  });

  it('partitions farms and vets, groups links per farm, filters by governorate and search', async () => {
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
    const sheep = await createSheepFarm(app, owner.accessToken, admin.accessToken);
    await getTestDb()('farm_details')
      .where({ organization_id: linkedFarm.id })
      .update({ governorate: 'نينوى' });
    await getTestDb()('farm_details')
      .where({ organization_id: freeFarm.id })
      .update({ governorate: 'بغداد' });

    expect((await joinFarm(app, linkedVet.accessToken, linkedFarm.joinCode)).status).toBe(201);
    await assignOrganizationSupervisor(app, owner.accessToken, linkedFarm.id, {
      userId: supervisingVet.id,
      permissions: ['farm.poultry.read'],
    });
    // a vet linked only to a sheep farm is still "unlinked" for poultry
    expect((await joinFarm(app, freeVet.accessToken, sheep.joinCode)).status).toBe(201);

    const linked = await get<LinkedFarmRow[]>(admin.accessToken, '/linked-farms');
    expect(linked.total).toBe(1);
    expect(linked.data[0]!.farm).toMatchObject({
      organizationId: linkedFarm.id,
      name: 'مزرعة مرتبطة',
      ownerUserId: owner.id,
    });
    const roles = Object.fromEntries(
      linked.data[0]!.links.map((l) => [l.veterinarian.userId, l.role]),
    );
    expect(roles).toEqual({ [linkedVet.id]: 'VETERINARIAN', [supervisingVet.id]: 'SUPERVISOR' });

    const farms = await get<Array<{ organizationId: string }>>(
      admin.accessToken,
      '/unlinked-farms',
    );
    expect(farms.data.map((f) => f.organizationId)).toEqual([freeFarm.id]);

    const unlinkedVets = await get<VetRow[]>(admin.accessToken, '/veterinarians?link=unlinked');
    const unlinkedIds = unlinkedVets.data.map((v) => v.veterinarian.userId);
    expect(unlinkedIds).toContain(freeVet.id);
    expect(unlinkedIds).not.toContain(linkedVet.id);
    expect(unlinkedIds).not.toContain(pendingVet.id);
    const linkedVets = await get<VetRow[]>(admin.accessToken, '/veterinarians?link=linked');
    const lv = linkedVets.data.find((v) => v.veterinarian.userId === linkedVet.id);
    expect(lv?.links.map((l) => l.farm.organizationId)).toEqual([linkedFarm.id]);

    const summary = await get<Record<string, number>>(admin.accessToken, '/summary');
    expect(summary.data).toEqual({
      linkedFarms: 1,
      unlinkedFarms: 1,
      linkedVeterinarians: 2,
      unlinkedVeterinarians: unlinkedVets.total,
    });

    // governorate filter — farms and counters
    const ninawa = await get<Record<string, number>>(
      admin.accessToken,
      `/summary?governorate=${encodeURIComponent('نينوى')}`,
    );
    expect(ninawa.data.linkedFarms).toBe(1);
    expect(ninawa.data.unlinkedFarms).toBe(0);
    expect(
      (
        await get<unknown[]>(
          admin.accessToken,
          `/unlinked-farms?governorate=${encodeURIComponent('نينوى')}`,
        )
      ).total,
    ).toBe(0);

    // search: a linked farm is found by its vet; pagination meta is correct
    const byVet = await get<LinkedFarmRow[]>(
      admin.accessToken,
      `/linked-farms?search=${encodeURIComponent(linkedVet.email)}`,
    );
    expect(byVet.total).toBe(1);
    const byFarmId = await get<unknown[]>(
      admin.accessToken,
      `/unlinked-farms?search=${freeFarm.id.slice(0, 8)}`,
    );
    expect(byFarmId.total).toBe(1);
    const page2 = await request(app)
      .get(api('/veterinarians?page=2&pageSize=1'))
      .set(bearer(admin.accessToken));
    expect(page2.body.meta).toMatchObject({ page: 2, pageSize: 1 });
    expect(page2.body.data).toHaveLength(1);
  });

  it('a vet who leaves is unlinked; re-joining re-links with a NEW assignment date', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await joinFarm(app, vet.accessToken, farm.joinCode);

    const first = await get<LinkedFarmRow[]>(admin.accessToken, '/linked-farms');
    const membershipId = first.data[0]!.links[0]!.membershipId;
    await getTestDb()('organization_memberships')
      .where({ id: membershipId })
      .update({ assigned_at: new Date('2025-01-01T00:00:00Z') });

    const left = await request(app)
      .post(`/api/v1/organizations/${farm.id}/leave`)
      .set(bearer(vet.accessToken));
    expect(left.status).toBeLessThan(300);
    expect((await get<unknown[]>(admin.accessToken, '/linked-farms')).total).toBe(0);
    expect((await get<unknown[]>(admin.accessToken, '/unlinked-farms')).total).toBe(1);

    await joinFarm(app, vet.accessToken, farm.joinCode);
    const again = await get<LinkedFarmRow[]>(admin.accessToken, '/linked-farms');
    expect(again.data[0]!.links[0]!.membershipId).toBe(membershipId);
    expect(Date.parse(again.data[0]!.links[0]!.assignedAt)).toBeGreaterThan(
      Date.parse('2026-01-01T00:00:00Z'),
    );
  });

  it('a deleted (DEACTIVATED) farm drops out of every list and frees its vet', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await joinFarm(app, vet.accessToken, farm.joinCode);
    const del = await request(app)
      .delete(`/api/v1/admin/organizations/${farm.id}`)
      .set(bearer(admin.accessToken))
      .send({});
    expect(del.status).toBe(200);
    expect((await get<unknown[]>(admin.accessToken, '/linked-farms')).total).toBe(0);
    expect((await get<unknown[]>(admin.accessToken, '/unlinked-farms')).total).toBe(0);
    const vets = await get<VetRow[]>(admin.accessToken, '/veterinarians?link=unlinked');
    expect(vets.data.map((v) => v.veterinarian.userId)).toContain(vet.id);
  });
});

describe('Admin — Poultry Supervisors Management (link / change / unlink)', () => {
  it('links a vet with type, start date and notes; the vet becomes a VETERINARIAN member and is notified', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);

    const res = await link(admin.accessToken, {
      organizationId: farm.id,
      veterinarianUserId: vet.id,
      supervisionType: 'RESIDENT',
      startDate: '2026-1-15',
      notes: 'زيارة أسبوعية',
    });
    expect(res.status).toBe(201);

    const linked = await get<LinkedFarmRow[]>(admin.accessToken, '/linked-farms');
    expect(linked.data[0]!.links[0]).toMatchObject({
      role: 'VETERINARIAN',
      supervisionType: 'RESIDENT',
      notes: 'زيارة أسبوعية',
      veterinarian: { userId: vet.id },
    });
    expect(linked.data[0]!.links[0]!.assignedAt).toBe('2026-01-14T21:00:00.000Z');

    // the vet is now a real member of the farm (same model as the join code)
    const mine = await request(app).get('/api/v1/organizations').set(bearer(vet.accessToken));
    expect(mine.body.data.map((o: { id: string }) => o.id)).toContain(farm.id);

    await expect
      .poll(async () => {
        const n = await listNotifications(app, vet.accessToken);
        return (n.body.data as Array<{ type: string }>).map((x) => x.type);
      })
      .toContain('ORGANIZATION_MEMBER_ADDED');
  });

  it('refuses: a second vet on a supervised farm, a future date, a non-approved vet, the farm owner, a sheep farm', async () => {
    const admin = await registerAdmin(app);
    const ownerVet = await registerApprovedVet(app);
    const vetA = await registerApprovedVet(app);
    const vetB = await registerApprovedVet(app);
    const pending = await registerPendingVet(app);
    const farm = await createFarm(app, ownerVet.accessToken, admin.accessToken);
    const sheep = await createSheepFarm(app, ownerVet.accessToken, admin.accessToken);

    const owner = await link(admin.accessToken, {
      organizationId: farm.id,
      veterinarianUserId: ownerVet.id,
    });
    expect(owner.status).toBe(409);
    expect(owner.body.error.code).toBe('FARM_MEMBER_HAS_OTHER_ROLE');

    const future = await link(admin.accessToken, {
      organizationId: farm.id,
      veterinarianUserId: vetA.id,
      startDate: '2099-1-1',
    });
    expect(future.status).toBe(400);

    const notApproved = await link(admin.accessToken, {
      organizationId: farm.id,
      veterinarianUserId: pending.id,
    });
    expect(notApproved.status).toBe(409);

    expect(
      (await link(admin.accessToken, { organizationId: sheep.id, veterinarianUserId: vetA.id }))
        .status,
    ).toBe(404);

    expect(
      (await link(admin.accessToken, { organizationId: farm.id, veterinarianUserId: vetA.id }))
        .status,
    ).toBe(201);
    const second = await link(admin.accessToken, {
      organizationId: farm.id,
      veterinarianUserId: vetB.id,
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('FARM_ALREADY_SUPERVISED');
  });

  it('changes the supervising vet in one step and unlinks', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const vetA = await registerApprovedVet(app);
    const vetB = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await joinFarm(app, vetA.accessToken, farm.joinCode);
    const before = await get<LinkedFarmRow[]>(admin.accessToken, '/linked-farms');
    const oldId = before.data[0]!.links[0]!.membershipId;

    const same = await request(app)
      .put(api(`/links/${oldId}/replace`))
      .set(bearer(admin.accessToken))
      .send({ veterinarianUserId: vetA.id, supervisionType: 'WEEKLY', startDate: today() });
    expect(same.status).toBe(409);

    const changed = await request(app)
      .put(api(`/links/${oldId}/replace`))
      .set(bearer(admin.accessToken))
      .send({ veterinarianUserId: vetB.id, supervisionType: 'EMERGENCY', startDate: today() });
    expect(changed.status).toBe(200);
    const after = await get<LinkedFarmRow[]>(admin.accessToken, '/linked-farms');
    expect(after.data[0]!.links.map((l) => l.veterinarian.userId)).toEqual([vetB.id]);
    expect(after.data[0]!.links[0]!.supervisionType).toBe('EMERGENCY');
    // vet A lost access to the farm
    const aOrgs = await request(app).get('/api/v1/organizations').set(bearer(vetA.accessToken));
    expect(aOrgs.body.data.map((o: { id: string }) => o.id)).not.toContain(farm.id);

    // the old link id is no longer a link
    expect(
      (
        await request(app)
          .delete(api(`/links/${oldId}`))
          .set(bearer(admin.accessToken))
      ).status,
    ).toBe(404);
    const unlink = await request(app)
      .delete(api(`/links/${changed.body.data.membershipId as string}`))
      .set(bearer(admin.accessToken));
    expect(unlink.status).toBe(200);
    expect((await get<unknown[]>(admin.accessToken, '/linked-farms')).total).toBe(0);
    expect((await get<unknown[]>(admin.accessToken, '/unlinked-farms')).total).toBe(1);

    // re-linking a REMOVED vet re-activates their membership row
    const relink = await link(admin.accessToken, {
      organizationId: farm.id,
      veterinarianUserId: vetA.id,
    });
    expect(relink.status).toBe(201);
    expect(relink.body.data.membershipId).toBe(oldId);
  });
});
