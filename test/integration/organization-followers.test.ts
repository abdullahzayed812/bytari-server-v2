import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  assignOrganizationSupervisor,
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

const follow = (token: string, orgId: string) =>
  request(app).post(`/api/v1/organizations/${orgId}/follow`).set(bearer(token)).expect(200);

/** Dashboard "Followers" page — clinic + veterinary office. */
describe.each(['CLINIC', 'VETERINARY_OFFICE'] as const)('%s followers page', (type) => {
  async function setup() {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type,
    });
    return { admin, owner, org, url: `/api/v1/organizations/${org.id}/followers` };
  }

  it('lists only this organization’s followers, names only, newest first', async () => {
    const { admin, owner, org, url } = await setup();
    const a = await registerUser(app);
    const b = await registerUser(app);
    const elsewhere = await registerUser(app);
    const otherOrg = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type,
    });
    await follow(a.accessToken, org.id);
    await follow(b.accessToken, org.id);
    await follow(elsewhere.accessToken, otherOrg.id);

    const res = await request(app).get(url).set(bearer(owner.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, total: 2 });
    expect(res.body.data.map((f: { userId: string }) => f.userId)).toEqual([b.id, a.id]);
    // Nothing beyond the name: no email, avatar or other profile data.
    for (const f of res.body.data) {
      expect(Object.keys(f).sort()).toEqual(['firstName', 'lastName', 'userId']);
    }
  });

  it('is limited to the owner and supervisors granted organization.broadcast.send', async () => {
    const { owner, org, url } = await setup();
    const fan = await registerUser(app);
    await follow(fan.accessToken, org.id);

    const vet = await registerApprovedVet(app);
    await addOrganizationMember(app, owner.accessToken, org.id, {
      userId: vet.id,
      role: 'VETERINARIAN',
    });
    expect((await request(app).get(url).set(bearer(vet.accessToken))).status).toBe(403);
    expect((await request(app).get(url).set(bearer(fan.accessToken))).status).toBe(403);

    const sup = await registerApprovedVet(app);
    await assignOrganizationSupervisor(app, owner.accessToken, org.id, {
      userId: sup.id,
      permissions: ['organization.broadcast.send'],
    });
    const asSup = await request(app).get(url).set(bearer(sup.accessToken));
    expect(asSup.status).toBe(200);
    expect(asSup.body.data).toHaveLength(1);
  });

  it('"Send Message" opens the organization chat with that follower', async () => {
    const { owner, org, url } = await setup();
    const fan = await registerUser(app);
    await follow(fan.accessToken, org.id);
    const [entry] = (await request(app).get(url).set(bearer(owner.accessToken))).body.data;

    const chat = await request(app)
      .post(`/api/v1/organizations/${org.id}/conversations`)
      .set(bearer(owner.accessToken))
      .send({ targetUserId: entry.userId });
    expect([200, 201]).toContain(chat.status);
    expect(chat.body.data.conversation ?? chat.body.data).toMatchObject({
      organizationId: org.id,
    });
  });
});
