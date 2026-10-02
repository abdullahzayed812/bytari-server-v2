import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createFarm,
  createPoultryFlock,
  joinFarm,
  listNotifications,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  sendChatMessage,
  startConversation,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

async function farmWithVetAndStaff() {
  const admin = await registerAdmin(app);
  const owner = await registerUser(app);
  const farm = await createFarm(app, owner.accessToken, admin.accessToken);
  const vet = await registerApprovedVet(app);
  expect((await joinFarm(app, vet.accessToken, farm.joinCode)).status).toBe(201);
  const staff = await registerUser(app);
  await addOrganizationMember(app, owner.accessToken, farm.id, {
    userId: staff.id,
    role: 'STAFF',
  });
  return { admin, owner, farm, vet, staff };
}

/** Final corrections §9 — a farm's veterinarian and employees. */
describe('farm dashboard — veterinarians and employees', () => {
  it('a vet who joined sees the active batch, daily data and weekly report exactly like staff', async () => {
    const { owner, farm, vet, staff } = await farmWithVetAndStaff();
    const flock = await createPoultryFlock(app, owner.accessToken, farm.id);
    const base = `/api/v1/organizations/${farm.id}/poultry/flocks`;
    for (const who of [vet, staff]) {
      const active = await request(app)
        .get(`${base}?status=ACTIVE&pageSize=1`)
        .set(bearer(who.accessToken));
      expect(active.status).toBe(200);
      expect(active.body.data[0].id).toBe(flock.id);
      for (const p of ['summary', 'weekly-summary', 'daily-records/weeks']) {
        const r = await request(app).get(`${base}/${flock.id}/${p}`).set(bearer(who.accessToken));
        expect(r.status).toBe(200);
      }
    }
  });

  it('staff and vets see each other in the member list', async () => {
    const { farm, vet, staff } = await farmWithVetAndStaff();
    for (const who of [vet, staff]) {
      const res = await request(app)
        .get(`/api/v1/organizations/${farm.id}/members?status=ACTIVE`)
        .set(bearer(who.accessToken));
      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ userId: string }>).map((m) => m.userId);
      expect(ids).toEqual(expect.arrayContaining([vet.id, staff.id]));
    }
  });

  it('they can message each other (one colleagues conversation per pair) and are notified', async () => {
    const { farm, vet, staff } = await farmWithVetAndStaff();
    const conv = await startConversation(app, vet.accessToken, farm.id, staff.id);
    expect(conv.type).toBe('FARM_MEMBER_DIRECT');
    expect(conv.counterpartUserId).toBe(staff.id);

    const again = await startConversation(app, staff.accessToken, farm.id, vet.id);
    expect(again.id).toBe(conv.id);
    expect(again.counterpartUserId).toBe(vet.id);

    expect((await sendChatMessage(app, vet.accessToken, conv.id, 'تم إعطاء اللقاح')).status).toBe(
      201,
    );
    await tick();
    const n = await listNotifications(app, staff.accessToken);
    expect(n.body.data.map((x: { type: string }) => x.type)).toContain('CHAT_MESSAGE_RECEIVED');

    const outsider = await registerUser(app);
    const leak = await request(app)
      .get(`/api/v1/conversations/${conv.id}`)
      .set(bearer(outsider.accessToken));
    expect(leak.status).toBe(404);
  });

  it('a non-member cannot open a colleagues chat; a removed colleague loses access', async () => {
    const { owner, farm, vet, staff } = await farmWithVetAndStaff();
    const outsider = await registerUser(app);
    const denied = await request(app)
      .post(`/api/v1/organizations/${farm.id}/conversations`)
      .set(bearer(outsider.accessToken))
      .send({ targetUserId: staff.id });
    expect(denied.status).toBe(403);

    const conv = await startConversation(app, vet.accessToken, farm.id, staff.id);
    const members = await request(app)
      .get(`/api/v1/organizations/${farm.id}/members?status=ACTIVE`)
      .set(bearer(owner.accessToken));
    const staffMembership = (members.body.data as Array<{ id: string; userId: string }>).find(
      (m) => m.userId === staff.id,
    );
    const removed = await request(app)
      .delete(`/api/v1/organizations/${farm.id}/members/${staffMembership?.id}`)
      .set(bearer(owner.accessToken));
    expect(removed.status).toBeLessThan(300);
    const gone = await request(app)
      .get(`/api/v1/conversations/${conv.id}`)
      .set(bearer(staff.accessToken));
    expect(gone.status).toBe(404);
  });

  it('vets and staff can NOT remove each other', async () => {
    const { owner, farm, vet, staff } = await farmWithVetAndStaff();
    const members = await request(app)
      .get(`/api/v1/organizations/${farm.id}/members?status=ACTIVE`)
      .set(bearer(owner.accessToken));
    const list = members.body.data as Array<{ id: string; userId: string }>;
    const vetM = list.find((m) => m.userId === vet.id);
    const staffM = list.find((m) => m.userId === staff.id);

    const vetRemovesStaff = await request(app)
      .delete(`/api/v1/organizations/${farm.id}/members/${staffM?.id}`)
      .set(bearer(vet.accessToken));
    expect(vetRemovesStaff.status).toBe(403);
    const staffRemovesVet = await request(app)
      .delete(`/api/v1/organizations/${farm.id}/members/${vetM?.id}`)
      .set(bearer(staff.accessToken));
    expect(staffRemovesVet.status).toBe(403);
  });
});
