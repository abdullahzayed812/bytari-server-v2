import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addOrganizationMember,
  bearer,
  createFarm,
  createPoultryFlock,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();
const API = '/api/v1/organizations';
const today = new Date().toISOString().slice(0, 10);

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

/** An ACTIVE farm with its owner, a joined veterinarian and a STAFF employee. */
async function farmWithStaff() {
  const admin = await registerAdmin(app);
  const owner = await registerApprovedVet(app);
  const vet = await registerApprovedVet(app);
  const staff = await registerUser(app);
  const farm = await createFarm(app, owner.accessToken, admin.accessToken);
  await addOrganizationMember(app, owner.accessToken, farm.id, {
    userId: vet.id,
    role: 'VETERINARIAN',
  });
  await addOrganizationMember(app, owner.accessToken, farm.id, { userId: staff.id, role: 'STAFF' });
  // The owner creates the batch (with its sale price) — batch creation is owner-level.
  const flock = await createPoultryFlock(app, owner.accessToken, farm.id);
  await request(app)
    .patch(`${API}/${farm.id}/poultry/flocks/${flock.id}`)
    .set(bearer(owner.accessToken))
    .send({ targetPricePerKg: 2500, averageWeightGrams: 1800 })
    .expect(200);
  return { admin, owner, vet, staff, farm, flock };
}

describe('farm employees / veterinarians — operational access only', () => {
  it('staff and vets run daily operations (daily data, treatments, vaccinations, expenses, appointments)', async () => {
    const { vet, staff, farm, flock } = await farmWithStaff();
    for (const actor of [vet, staff]) {
      const daily = await request(app)
        .post(`${API}/${farm.id}/poultry/flocks/${flock.id}/daily-records`)
        .set(bearer(actor.accessToken))
        .send({ feedKg: 120, mortalityCount: 1 });
      // one daily record per day per batch — the second actor hits the uniqueness rule
      expect([201, 409]).toContain(daily.status);

      for (const kind of ['TREATMENT', 'VACCINATION']) {
        const ev = await request(app)
          .post(`${API}/${farm.id}/poultry/flocks/${flock.id}/health-events`)
          .set(bearer(actor.accessToken))
          .send({ kind, name: `${kind} ${actor.id.slice(0, 4)}`, eventDate: today });
        expect(ev.status).toBe(201);
      }

      const expense = await request(app)
        .post(`${API}/${farm.id}/farm/expenses`)
        .set(bearer(actor.accessToken))
        .send({ category: 'FEED', amount: 50000, spentOn: today, poultryFlockId: flock.id });
      expect(expense.status).toBe(201);
    }
    const staffDaily = await request(app)
      .get(`${API}/${farm.id}/poultry/flocks/${flock.id}/daily-records`)
      .set(bearer(staff.accessToken));
    expect(staffDaily.status).toBe(200);
  });

  it('staff and vets cannot create or delete a batch', async () => {
    const { vet, staff, farm, flock } = await farmWithStaff();
    for (const actor of [vet, staff]) {
      const create = await request(app)
        .post(`${API}/${farm.id}/poultry/flocks`)
        .set(bearer(actor.accessToken))
        .send({ name: 'x', birdType: 'CHICKEN', birdCount: 10, arrivalDate: '2026-02-01' });
      expect(create.status).toBe(403);
      const del = await request(app)
        .delete(`${API}/${farm.id}/poultry/flocks/${flock.id}`)
        .set(bearer(actor.accessToken));
      expect(del.status).toBe(403);
    }
  });

  it('only the owner / admin may sell (close) a batch; a vet may still edit its operational fields', async () => {
    const { admin, owner, vet, staff, farm, flock } = await farmWithStaff();
    const url = `${API}/${farm.id}/poultry/flocks/${flock.id}`;

    const vetSell = await request(app)
      .patch(url)
      .set(bearer(vet.accessToken))
      .send({ status: 'CLOSED' });
    expect(vetSell.status).toBe(403);
    const staffSell = await request(app)
      .patch(url)
      .set(bearer(staff.accessToken))
      .send({ status: 'CLOSED' });
    expect(staffSell.status).toBe(403);

    const vetEdit = await request(app)
      .patch(url)
      .set(bearer(vet.accessToken))
      .send({ notes: 'ok' });
    expect(vetEdit.status).toBe(200);

    const ownerSell = await request(app)
      .patch(url)
      .set(bearer(owner.accessToken))
      .send({ status: 'CLOSED' });
    expect(ownerSell.status).toBe(200);
    expect(ownerSell.body.data.status).toBe('CLOSED');

    const adminReopen = await request(app)
      .patch(url)
      .set(bearer(admin.accessToken))
      .send({ status: 'ACTIVE' });
    expect(adminReopen.status).toBe(200);
  });

  it('staff and vets never see the estimated profit or the sale price; the owner does', async () => {
    const { owner, vet, staff, farm, flock } = await farmWithStaff();
    const summaryUrl = `${API}/${farm.id}/poultry/flocks/${flock.id}/summary`;

    const asOwner = await request(app).get(summaryUrl).set(bearer(owner.accessToken));
    expect(asOwner.body.data.financialsVisible).toBe(true);
    expect(Number(asOwner.body.data.targetPricePerKg)).toBe(2500);

    for (const actor of [vet, staff]) {
      const res = await request(app).get(summaryUrl).set(bearer(actor.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.financialsVisible).toBe(false);
      expect(res.body.data.estimatedProfit).toBeNull();
      expect(res.body.data.targetPricePerKg).toBeNull();
    }

    // …and a vet cannot set the price through an edit either (the field is dropped).
    await request(app)
      .patch(`${API}/${farm.id}/poultry/flocks/${flock.id}`)
      .set(bearer(vet.accessToken))
      .send({ targetPricePerKg: 1 })
      .expect(200);
    const after = await request(app).get(summaryUrl).set(bearer(owner.accessToken));
    expect(Number(after.body.data.targetPricePerKg)).toBe(2500);
  });

  it('the owner can remove an employee; an employee cannot remove anyone', async () => {
    const { owner, vet, staff, farm } = await farmWithStaff();
    const members = await request(app)
      .get(`${API}/${farm.id}/members`)
      .set(bearer(owner.accessToken));
    const byUser = new Map(
      (members.body.data as Array<{ id: string; userId: string }>).map((m) => [m.userId, m.id]),
    );

    const staffTry = await request(app)
      .delete(`${API}/${farm.id}/members/${byUser.get(vet.id)}`)
      .set(bearer(staff.accessToken));
    expect(staffTry.status).toBe(403);

    const ownerRemove = await request(app)
      .delete(`${API}/${farm.id}/members/${byUser.get(staff.id)}`)
      .set(bearer(owner.accessToken));
    expect(ownerRemove.status).toBe(200);
  });

  it('owner ↔ member chats are FARM_OWNER_MEMBER; member ↔ member is the colleagues chat', async () => {
    const { owner, vet, staff, farm } = await farmWithStaff();
    const byOwner = await request(app)
      .post(`${API}/${farm.id}/conversations`)
      .set(bearer(owner.accessToken))
      .send({ targetUserId: staff.id });
    expect([200, 201]).toContain(byOwner.status);
    expect(byOwner.body.data.type).toBe('FARM_OWNER_MEMBER');

    // a member opens their own chat with the owner (no target)
    const byStaff = await request(app)
      .post(`${API}/${farm.id}/conversations`)
      .set(bearer(staff.accessToken))
      .send({});
    expect(byStaff.body.data.id).toBe(byOwner.body.data.id);
    // …and naming a colleague (the farm's vet) opens the separate colleagues chat
    // (final corrections §9) — never the owner's conversation.
    const memberToMember = await request(app)
      .post(`${API}/${farm.id}/conversations`)
      .set(bearer(staff.accessToken))
      .send({ targetUserId: vet.id });
    expect([200, 201]).toContain(memberToMember.status);
    expect(memberToMember.body.data.type).toBe('FARM_MEMBER_DIRECT');
    expect(memberToMember.body.data.id).not.toBe(byOwner.body.data.id);
  });
});
