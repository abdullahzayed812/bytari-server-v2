import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

/**
 * The unified "Employees" page (clinic + veterinary office dashboards): one
 * list over every membership role, people added by email as STAFF /
 * VETERINARIAN (member routes) or SUPERVISOR (supervisor routes), and a
 * supervisor can only be changed or removed by someone holding
 * `supervisor.remove` — even through the generic member routes.
 */
describe.each(['CLINIC', 'VETERINARY_OFFICE'] as const)('%s employees', (type) => {
  async function setup() {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type,
    });
    const base = `/api/v1/organizations/${org.id}`;
    return { owner, org, base };
  }

  it('the owner adds an employee, a veterinarian and a supervisor by email; one list shows all three', async () => {
    const { owner, base } = await setup();
    const staff = await registerUser(app);
    const vet = await registerApprovedVet(app);
    const sup = await registerApprovedVet(app);

    await request(app)
      .post(`${base}/members`)
      .set(bearer(owner.accessToken))
      .send({ email: staff.email, role: 'STAFF' })
      .expect(201);
    await request(app)
      .post(`${base}/members`)
      .set(bearer(owner.accessToken))
      .send({ email: vet.email, role: 'VETERINARIAN' })
      .expect(201);
    await request(app)
      .post(`${base}/supervisors`)
      .set(bearer(owner.accessToken))
      .send({ email: sup.email, permissions: ['member.read'] })
      .expect(201);

    const list = await request(app).get(`${base}/members`).set(bearer(owner.accessToken));
    expect(list.status).toBe(200);
    const roles = Object.fromEntries(
      (list.body.data as { userId: string; roleKey: string }[]).map((m) => [m.userId, m.roleKey]),
    );
    expect(roles[staff.id]).toBe('STAFF');
    expect(roles[vet.id]).toBe('VETERINARIAN');
    expect(roles[sup.id]).toBe('SUPERVISOR');

    // An unknown email is a 404, never a silently created account.
    const unknown = await request(app)
      .post(`${base}/members`)
      .set(bearer(owner.accessToken))
      .send({ email: 'nobody-here@example.com', role: 'STAFF' });
    expect(unknown.status).toBe(404);
  });

  it('a plain employee cannot add anyone (backend-enforced, 403)', async () => {
    const { owner, base } = await setup();
    const staff = await registerUser(app);
    await request(app)
      .post(`${base}/members`)
      .set(bearer(owner.accessToken))
      .send({ email: staff.email, role: 'STAFF' })
      .expect(201);
    const other = await registerUser(app);
    const vet = await registerApprovedVet(app);

    const add = await request(app)
      .post(`${base}/members`)
      .set(bearer(staff.accessToken))
      .send({ email: other.email, role: 'STAFF' });
    expect(add.status).toBe(403);
    const assign = await request(app)
      .post(`${base}/supervisors`)
      .set(bearer(staff.accessToken))
      .send({ email: vet.email, permissions: ['member.read'] });
    expect(assign.status).toBe(403);
  });

  it('a member manager without supervisor.remove cannot demote or remove a supervisor via the member routes', async () => {
    const { owner, base } = await setup();
    const manager = await registerApprovedVet(app);
    const target = await registerApprovedVet(app);
    const staff = await registerUser(app);
    await request(app)
      .post(`${base}/supervisors`)
      .set(bearer(owner.accessToken))
      .send({
        email: manager.email,
        permissions: ['member.read', 'member.update', 'member.remove'],
      })
      .expect(201);
    const targetSup = await request(app)
      .post(`${base}/supervisors`)
      .set(bearer(owner.accessToken))
      .send({ email: target.email, permissions: ['member.read'] })
      .expect(201);
    const staffMember = await request(app)
      .post(`${base}/members`)
      .set(bearer(owner.accessToken))
      .send({ email: staff.email, role: 'STAFF' })
      .expect(201);

    const demote = await request(app)
      .patch(`${base}/members/${targetSup.body.data.id}`)
      .set(bearer(manager.accessToken))
      .send({ role: 'STAFF' });
    expect(demote.status).toBe(403);
    const remove = await request(app)
      .delete(`${base}/members/${targetSup.body.data.id}`)
      .set(bearer(manager.accessToken));
    expect(remove.status).toBe(403);

    // Ordinary employees remain theirs to manage.
    const suspend = await request(app)
      .patch(`${base}/members/${staffMember.body.data.id}`)
      .set(bearer(manager.accessToken))
      .send({ status: 'SUSPENDED' });
    expect(suspend.status).toBe(200);
  });

  it('the owner moving a supervisor to an ordinary role clears their supervisor grants', async () => {
    const { owner, base } = await setup();
    const sup = await registerApprovedVet(app);
    const assigned = await request(app)
      .post(`${base}/supervisors`)
      .set(bearer(owner.accessToken))
      .send({ email: sup.email, permissions: ['member.read', 'member.add'] })
      .expect(201);
    const membershipId = assigned.body.data.id as string;

    const res = await request(app)
      .patch(`${base}/members/${membershipId}`)
      .set(bearer(owner.accessToken))
      .send({ role: 'VETERINARIAN' });
    expect(res.status).toBe(200);
    expect(res.body.data.roleKey).toBe('VETERINARIAN');
    expect(
      await getTestDb()('organization_supervisor_permissions').where({
        membership_id: membershipId,
      }),
    ).toHaveLength(0);
    const supervisors = await request(app)
      .get(`${base}/supervisors`)
      .set(bearer(owner.accessToken));
    expect(supervisors.body.data).toHaveLength(0);

    // …and lost the supervisor-only capability (member.add is not a VETERINARIAN default).
    const other = await registerUser(app);
    const add = await request(app)
      .post(`${base}/members`)
      .set(bearer(sup.accessToken))
      .send({ email: other.email, role: 'STAFF' });
    expect(add.status).toBe(403);
  });
});
