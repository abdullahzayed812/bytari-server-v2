import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  assignOrganizationSupervisor,
  bearer,
  createActiveOrganization,
  createFarm,
  joinFarm,
  listChatMessages,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  sendChatMessage,
  startConversation,
} from '../helpers/factories.js';
import { ORG_PERMISSION_KEYS } from '../../src/modules/organizations/domain/organization-rbac.constants.js';

const { app } = buildTestApp();
const API = '/api/v1';

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function setPeriod(table: string, organizationId: string, start: string, end: string) {
  await getTestDb()(table)
    .where({ organization_id: organizationId })
    .update({ subscription_start_date: start, subscription_end_date: end });
}

/**
 * Subscription expiry closes the organization side of its chats for EVERY
 * member (owner, veterinarian, employee) — veterinary offices and farms too,
 * not only clinics — and `GET /organizations/:id` exposes the caller's exact
 * permission keys so the app shows only what the owner granted.
 */
describe('expired VETERINARY_OFFICE — pet-owner chat closed for owner and staff', () => {
  it('members lose the office side, the pet owner cannot post; renewal restores both', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const staff = await registerUser(app);
    const petOwner = await registerUser(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    await addOrganizationMember(app, owner.accessToken, office.id, {
      userId: staff.id,
      role: 'STAFF',
    });
    const conv = await startConversation(app, petOwner.accessToken, office.id);
    expect((await sendChatMessage(app, staff.accessToken, conv.id, 'متوفر')).status).toBe(201);

    await setPeriod('veterinary_office_details', office.id, '2020-01-01', '2020-12-31');
    for (const member of [owner, staff]) {
      expect((await listChatMessages(app, member.accessToken, conv.id)).status).toBe(404);
      expect((await sendChatMessage(app, member.accessToken, conv.id, 'رد')).status).toBe(404);
      const list = await request(app)
        .get(`${API}/conversations`)
        .query({ organizationId: office.id })
        .set(bearer(member.accessToken));
      expect(list.body.data.map((c: { id: string }) => c.id)).not.toContain(conv.id);
    }
    const blocked = await sendChatMessage(app, petOwner.accessToken, conv.id, 'مرحبا');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ORGANIZATION_SUBSCRIPTION_EXPIRED');
    // History stays readable for the pet owner.
    expect((await listChatMessages(app, petOwner.accessToken, conv.id)).status).toBe(200);

    await setPeriod('veterinary_office_details', office.id, '2020-01-01', '2999-12-31');
    expect((await sendChatMessage(app, staff.accessToken, conv.id, 'عدنا')).status).toBe(201);
    expect((await sendChatMessage(app, petOwner.accessToken, conv.id, 'شكراً')).status).toBe(201);
  });
});

describe('FARM whose subscription is not ACTIVE — team chats are read-only', () => {
  it('owner and vet keep the history but cannot post or open chats until renewal', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const farm = await createFarm(app, owner.accessToken, admin.accessToken);
    await joinFarm(app, vet.accessToken, farm.joinCode);
    const conv = await startConversation(app, owner.accessToken, farm.id, vet.id);
    expect((await sendChatMessage(app, vet.accessToken, conv.id, 'تم')).status).toBe(201);

    await setPeriod('farm_details', farm.id, '2020-01-01', '2020-12-31');
    for (const member of [owner, vet]) {
      const send = await sendChatMessage(app, member.accessToken, conv.id, 'بعد الانتهاء');
      expect(send.status).toBe(403);
      expect(send.body.error.code).toBe('FARM_SUBSCRIPTION_NOT_ACTIVE');
      expect((await listChatMessages(app, member.accessToken, conv.id)).status).toBe(200);
    }
    const open = await request(app)
      .post(`${API}/organizations/${farm.id}/conversations`)
      .set(bearer(vet.accessToken))
      .send({});
    expect(open.status).toBe(403);
    expect(open.body.error.code).toBe('FARM_SUBSCRIPTION_NOT_ACTIVE');

    await setPeriod('farm_details', farm.id, '2020-01-01', '2999-12-31');
    expect((await sendChatMessage(app, owner.accessToken, conv.id, 'عدنا')).status).toBe(201);
  });
});

describe('GET /organizations/:id — myPermissions (what the owner granted)', () => {
  it('owner: full catalogue; vet: role grants; supervisor: exactly the selected keys', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const vet = await registerApprovedVet(app);
    const supervisor = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
    });
    await addOrganizationMember(app, owner.accessToken, clinic.id, {
      userId: vet.id,
      role: 'VETERINARIAN',
    });
    const granted = [
      'organization.read',
      'animal.veterinary.access.read',
      'medical_record.read',
      'clinic.appointment.read',
    ];
    await assignOrganizationSupervisor(app, owner.accessToken, clinic.id, {
      userId: supervisor.id,
      permissions: granted,
    });

    const detail = (token: string) =>
      request(app).get(`${API}/organizations/${clinic.id}`).set(bearer(token));

    const asOwner = await detail(owner.accessToken);
    expect(asOwner.body.data.myRole).toBe('OWNER');
    expect([...asOwner.body.data.myPermissions].sort()).toEqual([...ORG_PERMISSION_KEYS].sort());

    const asVet = await detail(vet.accessToken);
    expect(asVet.body.data.myRole).toBe('VETERINARIAN');
    expect(asVet.body.data.myPermissions).toEqual(
      expect.arrayContaining(['medical_record.create', 'vaccination.read', 'member.read']),
    );
    expect(asVet.body.data.myPermissions).not.toContain('organization.update');
    expect(asVet.body.data.myPermissions).not.toContain('supervisor.read');

    const asSupervisor = await detail(supervisor.accessToken);
    expect(asSupervisor.body.data.myRole).toBe('SUPERVISOR');
    expect([...asSupervisor.body.data.myPermissions].sort()).toEqual([...granted].sort());

    const asAdmin = await detail(admin.accessToken);
    expect(asAdmin.body.data.myPermissions).toBeNull();

    // The dashboard summary + routes agree with the grants: sections granted
    // open, everything else stays closed.
    const summary = await request(app)
      .get(`${API}/organizations/${clinic.id}/clinic-dashboard/summary`)
      .set(bearer(supervisor.accessToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data.permissions).toMatchObject({
      canViewAnimals: true,
      canViewMedicalRecords: true,
      canCreateMedicalRecords: false,
      canViewAppointments: true,
      canManageAppointments: false,
      canViewMembers: false,
      canViewSupervisors: false,
      canEditOrganization: false,
      canSendBroadcast: false,
    });
    expect(summary.body.data.animals).not.toBeNull();
    const pets = await request(app)
      .get(`${API}/organizations/${clinic.id}/clinic-pets`)
      .set(bearer(supervisor.accessToken));
    expect(pets.status).toBe(200);
    for (const [method, url] of [
      ['get', `${API}/organizations/${clinic.id}/members`],
      ['get', `${API}/organizations/${clinic.id}/supervisors`],
      ['patch', `${API}/organizations/${clinic.id}`],
    ] as const) {
      const res = await request(app)
        [method](url)
        .set(bearer(supervisor.accessToken))
        .send({ description: 'تحديث' });
      expect(res.status, `${method} ${url}`).toBe(403);
    }
  });
});
