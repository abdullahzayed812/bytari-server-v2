import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { bearer, registerAdmin, registerUser } from '../helpers/factories.js';

const { app, container } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function principalFor(token: string): Promise<{
  userId: string;
  email: string;
  status: string;
  veterinarianStatus: string;
  roleKeys: string[];
  sessionId: string | null;
}> {
  const verified = await container.tokenService.verifyAccessToken(token);
  const user = await container.userService.getById(verified.userId);
  return {
    userId: user.id,
    email: user.email,
    status: user.status,
    veterinarianStatus: user.veterinarianStatus,
    roleKeys: await container.roleRepository.getRoleKeysForUser(user.id),
    sessionId: verified.sessionId,
  };
}

describe('veterinarian approval workflow', () => {
  it('apply → PENDING, visible in the admin queue', async () => {
    const u = await registerUser(app);
    const apply = await request(app)
      .post('/api/v1/veterinarians/apply')
      .set(bearer(u.accessToken))
      .send({ note: 'licensed 8 years' });
    expect(apply.status).toBe(201);
    expect(apply.body.data.status).toBe('PENDING');

    const status = await request(app)
      .get('/api/v1/veterinarians/me/status')
      .set(bearer(u.accessToken));
    expect(status.body.data.veterinarianStatus).toBe('PENDING');

    const admin = await registerAdmin(app);
    const pending = await request(app)
      .get('/api/v1/admin/veterinarians/pending')
      .set(bearer(admin.accessToken));
    expect(pending.body.data.map((a: { userId: string }) => a.userId)).toContain(u.id);
  });

  it('re-applying while PENDING is a 409', async () => {
    const u = await registerUser(app);
    await request(app).post('/api/v1/veterinarians/apply').set(bearer(u.accessToken)).send({});
    const again = await request(app)
      .post('/api/v1/veterinarians/apply')
      .set(bearer(u.accessToken))
      .send({});
    expect(again.status).toBe(409);
  });

  it('approval sets APPROVED, grants the VETERINARIAN role, and gates authz correctly', async () => {
    const u = await registerUser(app);
    await request(app).post('/api/v1/veterinarians/apply').set(bearer(u.accessToken)).send({});

    // before approval: not an approved vet
    const before = await principalFor(u.accessToken);
    expect(container.authorizationService.isApprovedVeterinarian(before)).toBe(false);
    expect(() => container.authorizationService.assertApprovedVeterinarian(before)).toThrow();

    const admin = await registerAdmin(app);
    const approve = await request(app)
      .post(`/api/v1/admin/veterinarians/${u.id}/approve`)
      .set(bearer(admin.accessToken));
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('APPROVED');

    // after approval: role granted + status APPROVED + authz passes
    const after = await principalFor(u.accessToken);
    expect(after.roleKeys).toContain('VETERINARIAN');
    expect(after.veterinarianStatus).toBe('APPROVED');
    expect(container.authorizationService.isApprovedVeterinarian(after)).toBe(true);
    expect(() => container.authorizationService.assertApprovedVeterinarian(after)).not.toThrow();
  });

  it('a user who merely holds the VETERINARIAN role but is not APPROVED gets no vet access', async () => {
    const admin = await registerAdmin(app);
    const u = await registerUser(app);
    await request(app)
      .post(`/api/v1/admin/users/${u.id}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roleKey: 'VETERINARIAN' });

    const principal = await principalFor(u.accessToken);
    expect(principal.roleKeys).toContain('VETERINARIAN');
    expect(principal.veterinarianStatus).toBe('NOT_APPLIED');
    expect(container.authorizationService.isApprovedVeterinarian(principal)).toBe(false);
  });

  it('rejection sets REJECTED with a reason; the user may re-apply', async () => {
    const u = await registerUser(app);
    await request(app).post('/api/v1/veterinarians/apply').set(bearer(u.accessToken)).send({});
    const admin = await registerAdmin(app);

    const reject = await request(app)
      .post(`/api/v1/admin/veterinarians/${u.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'license could not be verified' });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe('REJECTED');
    expect(reject.body.data.decisionReason).toBe('license could not be verified');

    const status = await request(app)
      .get('/api/v1/veterinarians/me/status')
      .set(bearer(u.accessToken));
    expect(status.body.data.veterinarianStatus).toBe('REJECTED');

    // re-apply is allowed after rejection
    const reapply = await request(app)
      .post('/api/v1/veterinarians/apply')
      .set(bearer(u.accessToken))
      .send({ note: 'attached updated license' });
    expect(reapply.status).toBe(201);
    expect(reapply.body.data.status).toBe('PENDING');
  });

  it('reject requires a reason (422)', async () => {
    const u = await registerUser(app);
    await request(app).post('/api/v1/veterinarians/apply').set(bearer(u.accessToken)).send({});
    const admin = await registerAdmin(app);
    const res = await request(app)
      .post(`/api/v1/admin/veterinarians/${u.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({});
    expect(res.status).toBe(422);
  });

  it('an admin cannot approve their own application', async () => {
    const admin = await registerAdmin(app);
    await request(app).post('/api/v1/veterinarians/apply').set(bearer(admin.accessToken)).send({});
    const res = await request(app)
      .post(`/api/v1/admin/veterinarians/${admin.id}/approve`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(403);
  });

  it('a non-privileged user cannot approve applications', async () => {
    const u = await registerUser(app);
    const other = await registerUser(app);
    await request(app).post('/api/v1/veterinarians/apply').set(bearer(u.accessToken)).send({});
    const res = await request(app)
      .post(`/api/v1/admin/veterinarians/${u.id}/approve`)
      .set(bearer(other.accessToken));
    expect(res.status).toBe(403);
  });
});
