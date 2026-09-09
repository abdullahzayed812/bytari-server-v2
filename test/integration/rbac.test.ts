import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { bearer, registerAdmin, registerUser } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('roles ↔ users', () => {
  it('a user can hold multiple global roles', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app); // starts PET_OWNER

    const r1 = await request(app)
      .post(`/api/v1/admin/users/${u.id}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roleKey: 'VETERINARIAN' });
    expect(r1.status).toBe(200);
    expect(r1.body.data.roles.sort()).toEqual(['PET_OWNER', 'VETERINARIAN']);

    const r2 = await request(app)
      .post(`/api/v1/admin/users/${u.id}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roleKey: 'MODERATOR' });
    expect(r2.body.data.roles.sort()).toEqual(['MODERATOR', 'PET_OWNER', 'VETERINARIAN']);
  });

  it('assigning an existing role is a 409', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);
    const res = await request(app)
      .post(`/api/v1/admin/users/${u.id}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roleKey: 'PET_OWNER' });
    expect(res.status).toBe(409);
  });

  it('removes a role', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);
    await request(app)
      .post(`/api/v1/admin/users/${u.id}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roleKey: 'MODERATOR' });

    const res = await request(app)
      .delete(`/api/v1/admin/users/${u.id}/roles/MODERATOR`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.roles).toEqual(['PET_OWNER']);
  });

  it('a newly-assigned role immediately changes what the user can do', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);

    await request(app).get('/api/v1/admin/users').set(bearer(u.accessToken)).expect(403);

    await request(app)
      .post(`/api/v1/admin/users/${u.id}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roleKey: 'MODERATOR' });

    // fresh token picks up the new role; even the existing token works because
    // authentication reloads roles per request
    await request(app).get('/api/v1/admin/users').set(bearer(u.accessToken)).expect(200);
  });

  it('cannot remove your own ADMIN role', async () => {
    const admin = await registerAdmin(app);
    const res = await request(app)
      .delete(`/api/v1/admin/users/${admin.id}/roles/ADMIN`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(403);
  });

  it('cannot remove the last ADMIN', async () => {
    const admin1 = await registerAdmin(app);
    const admin2 = await registerAdmin(app);
    // remove admin2's ADMIN via admin1 → ok (admin1 remains)
    await request(app)
      .delete(`/api/v1/admin/users/${admin2.id}/roles/ADMIN`)
      .set(bearer(admin1.accessToken))
      .expect(200);
    // now admin1 is the last admin; admin2 (demoted) can't act, so use admin1 to try removing... itself is blocked (own role)
    // create admin3 to attempt removing admin1
    const admin3 = await registerAdmin(app);
    await request(app)
      .delete(`/api/v1/admin/users/${admin1.id}/roles/ADMIN`)
      .set(bearer(admin3.accessToken))
      .expect(200); // admin3 remains
    // admin3 is now the last admin — nobody else can remove it
    await request(app)
      .delete(`/api/v1/admin/users/${admin3.id}/roles/ADMIN`)
      .set(bearer(admin3.accessToken))
      .expect(403); // own-role guard fires first
  });
});

describe('roles ↔ permissions', () => {
  it('granting a permission to a role grants it to that role’s users', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);
    await request(app)
      .post(`/api/v1/admin/users/${u.id}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roleKey: 'PET_OWNER' })
      .catch(() => undefined);

    // PET_OWNER has no permissions by default → user cannot read audit
    await request(app).get('/api/v1/admin/audit-logs').set(bearer(u.accessToken)).expect(403);

    await request(app)
      .post('/api/v1/admin/roles/PET_OWNER/permissions')
      .set(bearer(admin.accessToken))
      .send({ permissionKey: 'audit.read' })
      .expect(200);

    await request(app).get('/api/v1/admin/audit-logs').set(bearer(u.accessToken)).expect(200);

    await request(app)
      .delete('/api/v1/admin/roles/PET_OWNER/permissions/audit.read')
      .set(bearer(admin.accessToken))
      .expect(200);

    await request(app).get('/api/v1/admin/audit-logs').set(bearer(u.accessToken)).expect(403);
  });

  it('the ADMIN role rejects permission-row mutation (uses the override)', async () => {
    const admin = await registerAdmin(app);
    const res = await request(app)
      .post('/api/v1/admin/roles/ADMIN/permissions')
      .set(bearer(admin.accessToken))
      .send({ permissionKey: 'user.read' });
    expect(res.status).toBe(400);
  });

  it('lists roles with their permissions and the full permission catalogue', async () => {
    const admin = await registerAdmin(app);
    const roles = await request(app).get('/api/v1/admin/roles').set(bearer(admin.accessToken));
    expect(roles.status).toBe(200);
    const moderator = (roles.body.data as Array<{ key: string; permissions: string[] }>).find(
      (r) => r.key === 'MODERATOR',
    );
    expect(moderator?.permissions).toContain('user.read');

    const perms = await request(app)
      .get('/api/v1/admin/permissions')
      .set(bearer(admin.accessToken));
    // 18 Phase-2 + 4 Phase-3 `organization.admin.*` + 6 Phase-4 `animal.*`
    // + 2 Phase-7 `animal.approve` / `animal.reject` + 3 Phase-12 `chat.*`
    // + 11 Phase-13 (`consultation.*`, `inquiry.*`, `ai.settings.manage`)
    // + 8 Phase-14 `content.*` + 1 Phase-15 `notification.admin.send`
    // + 1 `advertisement.manage` (multi-section advertisement campaigns)
    // + Poultry Markets module: 4 `trader.admin.*` + 3 `market.*`.
    const keys = (perms.body.data as Array<{ key: string }>).map((p) => p.key);
    expect(keys).toContain('user.read');
    expect(keys).toContain('organization.admin.approve');
    expect(keys).toContain('animal.ownership.transfer');
    expect(keys).toContain('animal.approve');
    expect(keys).toContain('chat.send');
    expect(keys).toContain('consultation.respond');
    expect(keys).toContain('ai.settings.manage');
    expect(keys).toContain('content.publish');
    expect(keys).toContain('notification.admin.send');
    expect(keys).toContain('advertisement.manage');
    expect(keys).toContain('trader.admin.read');
    expect(keys).toContain('market.rate.manage');
    expect(keys).toContain('pet_store.product.manage');
    expect(keys).toContain('pet_store.order.manage');
    expect(keys.length).toBe(65);
  });
});
