import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  assignSystemSupervisor,
  bearer,
  createActiveOrganization,
  createAnimal,
  createFarm,
  createPoultryFlock,
  createVeterinaryOfficeProduct,
  listConversations,
  openClinicPet,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  sendChatMessage,
  startConversation,
} from '../helpers/factories.js';

const { app } = buildTestApp();
const API = '/api/v1';
const admin$ = (p: string): string => `${API}/admin/organizations${p}`;

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const softDelete = (adminToken: string, id: string) =>
  request(app)
    .delete(admin$(`/${id}`))
    .set(bearer(adminToken));
const purge = (token: string, id: string) =>
  request(app)
    .delete(admin$(`/${id}/permanent`))
    .set(bearer(token));
const myOrgIds = async (token: string): Promise<string[]> => {
  const res = await request(app).get(`${API}/organizations`).set(bearer(token));
  expect(res.status).toBe(200);
  return (res.body.data as { id: string }[]).map((o) => o.id);
};

describe('organization deletion — soft delete everywhere, permanent delete where safe', () => {
  it('a deleted office leaves the admin list, the owner/member "my organizations" and discovery', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const member = await registerApprovedVet(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'مكتب الحذف',
    });
    await addOrganizationMember(app, owner.accessToken, office.id, {
      userId: member.id,
      role: 'VETERINARIAN',
    });
    expect(await myOrgIds(owner.accessToken)).toContain(office.id);
    expect(await myOrgIds(member.accessToken)).toContain(office.id);

    expect((await softDelete(admin.accessToken, office.id)).status).toBe(200);

    const list = await request(app)
      .get(admin$('?type=VETERINARY_OFFICE'))
      .set(bearer(admin.accessToken));
    expect((list.body.data as { id: string }[]).map((o) => o.id)).not.toContain(office.id);
    const deletedTab = await request(app)
      .get(admin$('?type=VETERINARY_OFFICE&status=DEACTIVATED'))
      .set(bearer(admin.accessToken));
    expect((deletedTab.body.data as { id: string }[]).map((o) => o.id)).toEqual([office.id]);

    expect(await myOrgIds(owner.accessToken)).not.toContain(office.id);
    expect(await myOrgIds(member.accessToken)).not.toContain(office.id);
    const discover = await request(app)
      .get(`${API}/organizations/discover?type=VETERINARY_OFFICE`)
      .set(bearer(member.accessToken));
    expect((discover.body.data as { id: string }[]).map((o) => o.id)).not.toContain(office.id);
  });

  it('permanently deletes a soft-deleted farm with its own data — users and audit history survive', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken, { name: 'حقل' });
    await addOrganizationMember(app, owner.accessToken, farm.id, {
      userId: vet.id,
      role: 'VETERINARIAN',
    });
    const flock = await createPoultryFlock(app, owner.accessToken, farm.id, { name: 'دفعة 1' });
    const appt = await request(app)
      .post(`${API}/organizations/${farm.id}/farm/appointments`)
      .set(bearer(owner.accessToken))
      .send({ title: 'زيارة', scheduledFor: '2026-12-01', poultryFlockId: flock.id });
    expect(appt.status).toBe(201);

    // Step 1 is required: an active farm cannot be purged.
    const early = await purge(admin.accessToken, farm.id);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('ORGANIZATION_PURGE_BLOCKED');
    expect(early.body.error.details[0].rule).toBe('NOT_DELETED');

    expect((await softDelete(admin.accessToken, farm.id)).status).toBe(200);
    const res = await purge(admin.accessToken, farm.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: farm.id,
      deleted: true,
      removed: { poultry_flocks: 1, farm_appointments: 1 },
    });

    const db = getTestDb();
    expect(await db('organizations').where({ id: farm.id }).first()).toBeUndefined();
    expect(await db('poultry_flocks').where({ organization_id: farm.id })).toHaveLength(0);
    expect(await db('organization_memberships').where({ organization_id: farm.id })).toHaveLength(
      0,
    );
    // Owner + member accounts are untouched.
    expect(await db('users').whereIn('id', [owner.id, vet.id])).toHaveLength(2);
    // Audit history is retained: the soft delete AND the purge entry.
    const actions = (await db('audit_logs')
      .where({ entity_id: farm.id })
      .pluck('action')) as string[];
    expect(actions).toEqual(
      expect.arrayContaining(['ORGANIZATION_DELETED', 'ORGANIZATION_PURGED']),
    );
    expect(
      (
        await request(app)
          .get(admin$(`/${farm.id}`))
          .set(bearer(admin.accessToken))
      ).status,
    ).toBe(404);
    // Idempotent outcome for a repeated click: it is gone.
    expect((await purge(admin.accessToken, farm.id)).status).toBe(404);
  });

  it('permanently deletes an office with products and chats; the pet owner keeps the account, the thread is gone', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const petOwner = await registerUser(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    await createVeterinaryOfficeProduct(app, owner.accessToken, office.id, { name: 'دواء' });
    const conv = await startConversation(app, petOwner.accessToken, office.id);
    await sendChatMessage(app, petOwner.accessToken, conv.id, 'مرحبا');

    expect((await softDelete(admin.accessToken, office.id)).status).toBe(200);
    const res = await purge(admin.accessToken, office.id);
    expect(res.status).toBe(200);
    expect(res.body.data.removed).toMatchObject({ veterinary_office_products: 1 });

    const convs = await listConversations(app, petOwner.accessToken);
    expect(convs.status).toBe(200);
    expect((convs.body.data as { id: string }[]).map((c) => c.id)).not.toContain(conv.id);
    expect(await getTestDb()('users').where({ id: petOwner.id }).first()).toBeTruthy();
  });

  it("a clinic holding pet owners' medical history is never purged — it stays soft-deleted", async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const petOwner = await registerUser(app);
    const clinic = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    const pet = await createAnimal(app, petOwner.accessToken, { name: 'Milo' });
    await openClinicPet(app, owner.accessToken, clinic.id, pet.publicCode);
    const vax = await request(app)
      .post(`${API}/organizations/${clinic.id}/animals/${pet.id}/vaccinations`)
      .set(bearer(owner.accessToken))
      .send({ vaccineName: 'Rabies', administeredOn: '2026-10-01' });
    expect(vax.status).toBe(201);

    expect((await softDelete(admin.accessToken, clinic.id)).status).toBe(200);
    const res = await purge(admin.accessToken, clinic.id);
    expect(res.status).toBe(409);
    expect(res.body.error.details[0].rule).toBe('HOLDS_PET_OWNER_RECORDS');

    const db = getTestDb();
    expect(await db('organizations').where({ id: clinic.id }).first()).toMatchObject({
      status: 'DEACTIVATED',
    });
    expect(await db('vaccinations').where({ id: vax.body.data.id }).first()).toBeTruthy();

    // An empty clinic, by contrast, is purged.
    const empty = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    await softDelete(admin.accessToken, empty.id);
    expect((await purge(admin.accessToken, empty.id)).status).toBe(200);
  });

  it('only ADMIN may purge: the owner and a CLINIC supervisor (who can soft delete) get 403; other types 409', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const supervisor = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, supervisor.id, 'CLINIC');
    const clinic = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });

    expect((await softDelete(supervisor.accessToken, clinic.id)).status).toBe(200);
    expect((await purge(owner.accessToken, clinic.id)).status).toBe(403);
    expect((await purge(supervisor.accessToken, clinic.id)).status).toBe(403);
    expect(await getTestDb()('organizations').where({ id: clinic.id }).first()).toBeTruthy();

    const store = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_STORE',
    });
    await softDelete(admin.accessToken, store.id);
    const res = await purge(admin.accessToken, store.id);
    expect(res.status).toBe(409);
    expect(res.body.error.details[0].rule).toBe('TYPE_NOT_PURGEABLE');
  });
});
