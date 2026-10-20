import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createOrganization,
  registerAdmin,
  registerApprovedVet,
  registerPendingVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();
const API = '/api/v1';

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function supervisor(adminToken: string, domains: string[]) {
  const sup = await registerUser(app);
  const res = await request(app)
    .put(`${API}/admin/supervisors/domains`)
    .set(bearer(adminToken))
    .send({ userId: sup.id, domains });
  expect(res.status).toBe(200);
  return sup;
}

async function tasksFor(token: string) {
  const res = await request(app).get(`${API}/admin/dashboard/summary`).set(bearer(token));
  return res;
}

describe('admin dashboard "required tasks" — per-permission visibility', () => {
  it('ADMIN sees every task; supervisors only the tasks their permissions allow', async () => {
    const admin = await registerAdmin(app);
    const applicant = await registerPendingVet(app);
    // VET_APPLICATION task (the queue reads `veterinarian_applications`).
    await getTestDb()('veterinarian_applications').insert({
      user_id: applicant.id,
      status: 'PENDING',
    });
    const owner = await registerApprovedVet(app);
    await createOrganization(app, owner.accessToken, { type: 'CLINIC', name: 'عيادة الاختبار' });
    const farmer = await registerUser(app);
    await createOrganization(app, farmer.accessToken, { type: 'FARM', name: 'مزرعة الاختبار' });

    const asAdmin = await tasksFor(admin.accessToken);
    expect(asAdmin.status).toBe(200);
    const adminKinds = asAdmin.body.data.pendingTasks.map((t: { kind: string }) => t.kind);
    expect(adminKinds).toContain('VET_APPLICATION');
    expect(adminKinds.filter((k: string) => k === 'ORGANIZATION_APPROVAL')).toHaveLength(2);

    // USERS supervisor: dashboard access, but none of these administrative tasks.
    const usersSup = await supervisor(admin.accessToken, ['USERS']);
    const asUsers = await tasksFor(usersSup.accessToken);
    expect(asUsers.status).toBe(200);
    expect(asUsers.body.data.pendingTasks).toEqual([]);

    // CLINIC supervisor: only the clinic approval (type-scoped), never the
    // farm one or the vet application.
    const clinicSup = await supervisor(admin.accessToken, ['CLINIC']);
    const asClinic = await tasksFor(clinicSup.accessToken);
    expect(asClinic.status).toBe(200);
    const clinicTasks = asClinic.body.data.pendingTasks as Array<{ kind: string; label: string }>;
    expect(clinicTasks.map((t) => t.kind)).toEqual(['ORGANIZATION_APPROVAL']);
    expect(clinicTasks[0]?.label).toContain('عيادة الاختبار');

    // VETERINARIANS supervisor: the vet application only.
    const vetSup = await supervisor(admin.accessToken, ['VETERINARIANS']);
    const asVet = await tasksFor(vetSup.accessToken);
    expect(asVet.body.data.pendingTasks.map((t: { kind: string }) => t.kind)).toEqual([
      'VET_APPLICATION',
    ]);
  });

  it('the underlying task endpoints refuse a supervisor without the permission', async () => {
    const admin = await registerAdmin(app);
    const usersSup = await supervisor(admin.accessToken, ['USERS']);
    const t = bearer(usersSup.accessToken);
    expect((await request(app).get(`${API}/admin/organizations/pending`).set(t)).status).toBe(403);
    expect(
      (await request(app).get(`${API}/admin/organizations/subscription-renewals/pending`).set(t))
        .status,
    ).toBe(403);
    expect((await request(app).get(`${API}/admin/veterinarians/pending`).set(t)).status).toBe(403);
    // A plain user cannot read the dashboard at all.
    const plain = await registerUser(app);
    expect((await tasksFor(plain.accessToken)).status).toBe(403);
  });
});
