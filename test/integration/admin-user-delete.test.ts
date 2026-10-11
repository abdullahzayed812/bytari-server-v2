import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  createAnimal,
  createAnimalPublication,
  openClinicPet,
  registerAdmin,
  registerApprovedVet,
  registerModerator,
  registerUser,
} from '../helpers/factories.js';
import { DELETED_USER_ID } from '../../src/modules/users/user.types.js';

const { app, container } = buildTestApp();
const API = '/api/v1';

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const del = (id: string, token: string) =>
  request(app).delete(`${API}/admin/users/${id}`).set(bearer(token));

describe('DELETE /admin/users/:id — permanent user deletion', () => {
  it('deletes the account, revokes access immediately and keeps clinic medical history', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app, { firstName: 'Sara', lastName: 'Ali' });
    const clinicOwner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, clinicOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Clinic A',
    });
    const pet = await createAnimal(app, owner.accessToken, { name: 'Milo' });
    await openClinicPet(app, clinicOwner.accessToken, clinic.id, pet.publicCode);
    const base = `${API}/organizations/${clinic.id}/animals/${pet.id}`;
    await request(app)
      .post(`${base}/vaccinations`)
      .set(bearer(clinicOwner.accessToken))
      .send({ vaccineName: 'Rabies', administeredOn: '2026-10-01' })
      .expect(201);
    await request(app)
      .post(`${base}/medical-records`)
      .set(bearer(clinicOwner.accessToken))
      .send({ diagnosis: 'Healthy' })
      .expect(201);
    const pub = await createAnimalPublication(app, owner.accessToken, pet.id, { kind: 'ADOPTION' });
    await getTestDb()('device_push_tokens').insert({
      user_id: owner.id,
      token: 'fcm-token-1',
      platform: 'android',
    });

    const res = await del(owner.id, admin.accessToken).expect(200);
    expect(res.body.data).toMatchObject({ id: owner.id, deleted: true });
    expect(res.body.data.retained).toMatchObject({ animal_ownerships: 1, animals: 1 });
    expect(res.body.data.removed).toMatchObject({ animal_publications: 1 });

    const db = getTestDb();
    // the account is really gone
    expect(await db('users').where({ id: owner.id }).first()).toBeUndefined();
    // sessions / device tokens / roles cascade away
    expect(await db('refresh_sessions').where({ user_id: owner.id })).toHaveLength(0);
    expect(await db('device_push_tokens').where({ user_id: owner.id })).toHaveLength(0);
    expect(await db('user_roles').where({ user_id: owner.id })).toHaveLength(0);
    expect(await db('animal_publications').where({ id: pub.id }).first()).toBeUndefined();

    // the still-valid access token and refresh token are dead
    await request(app).get(`${API}/auth/me`).set(bearer(owner.accessToken)).expect(401);
    const refreshed = await request(app)
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: owner.refreshToken });
    expect(refreshed.status).toBe(401);
    // and the credentials no longer sign in
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: owner.email, password: owner.password });
    expect(login.status).toBe(401);

    // the pet and its clinic history survive, owned by the placeholder, deactivated
    const animal = await db('animals').where({ id: pet.id }).first();
    expect(animal).toMatchObject({ status: 'DEACTIVATED', created_by: DELETED_USER_ID });
    expect(await db('vaccinations').where({ animal_id: pet.id })).toHaveLength(1);
    expect(await db('medical_records').where({ animal_id: pet.id })).toHaveLength(1);
    const own = await db('animal_ownerships').where({ animal_id: pet.id });
    expect(own.every((o: { owner_user_id: string }) => o.owner_user_id === DELETED_USER_ID)).toBe(
      true,
    );

    // audit: one USER_DELETED by the admin; earlier entries lost the personal data
    const entry = await db('audit_logs')
      .where({ action: 'USER_DELETED', entity_id: owner.id })
      .first();
    expect(entry.actor_user_id).toBe(admin.id);
    expect(JSON.stringify(entry.metadata)).not.toContain(owner.email);
    const about = await db('audit_logs').where({ entity_id: owner.id });
    expect(JSON.stringify(about.map((a: { metadata: unknown }) => a.metadata))).not.toContain(
      owner.email,
    );

    // the placeholder never shows up in the admin user list and cannot be deleted
    const list = await request(app)
      .get(`${API}/admin/users?pageSize=100`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(list.body.data.map((u: { id: string }) => u.id)).not.toContain(DELETED_USER_ID);
    const prot = await del(DELETED_USER_ID, admin.accessToken).expect(409);
    expect(prot.body.error).toMatchObject({ code: 'USER_DELETE_BLOCKED' });
    expect(prot.body.error.details[0].rule).toBe('PROTECTED_ACCOUNT');

    // repeated request → 404
    await del(owner.id, admin.accessToken).expect(404);
  });

  it('is ADMIN-only: a moderator and a plain user are forbidden', async () => {
    const moderator = await registerModerator(app);
    const plain = await registerUser(app);
    const target = await registerUser(app);
    await del(target.id, moderator.accessToken).expect(403);
    await del(target.id, plain.accessToken).expect(403);
    await request(app).delete(`${API}/admin/users/${target.id}`).expect(401);
    expect(await getTestDb()('users').where({ id: target.id }).first()).toBeDefined();
  });

  it('refuses self-deletion, admin accounts and organization owners with the exact reason', async () => {
    const admin = await registerAdmin(app);
    const otherAdmin = await registerAdmin(app);
    await del(admin.id, admin.accessToken).expect(403);

    const adminRes = await del(otherAdmin.id, admin.accessToken).expect(409);
    expect(adminRes.body.error.details[0].rule).toBe('ADMIN_ACCOUNT');

    const vet = await registerApprovedVet(app);
    await createActiveOrganization(app, vet.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Owned Clinic',
    });
    const ownerRes = await del(vet.id, admin.accessToken).expect(409);
    expect(ownerRes.body.error.details[0].rule).toBe('OWNS_ORGANIZATIONS');
    expect(ownerRes.body.error.message).toContain('Owned Clinic');
    // nothing was changed
    expect(await getTestDb()('users').where({ id: vet.id }).first()).toBeDefined();
    await request(app).get(`${API}/auth/me`).set(bearer(vet.accessToken)).expect(200);
  });

  it('rolls back completely when a step fails inside the transaction', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const pet = await createAnimal(app, owner.accessToken);
    const spy = vi
      .spyOn(container.auditService, 'record')
      .mockRejectedValueOnce(new Error('audit store down'));
    const res = await del(owner.id, admin.accessToken);
    spy.mockRestore();
    expect(res.status).toBe(500);
    const db = getTestDb();
    expect(await db('users').where({ id: owner.id }).first()).toBeDefined();
    expect(await db('animals').where({ id: pet.id }).first()).toMatchObject({
      status: 'ACTIVE',
      created_by: owner.id,
    });
    await request(app).get(`${API}/auth/me`).set(bearer(owner.accessToken)).expect(200);
  });
});
