import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  registerAdmin,
  registerApprovedVet,
  registerModerator,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

const EXPECTED_CARD_IDS = [
  'poultry',
  'livestock',
  'pets',
  'consultations',
  'inquiries',
  'ads',
  'clinics',
  'offices',
  'vetApprovals',
  'courses',
  'services',
  'content',
  'syndicate',
  'petOwners',
  'veterinarians',
  'chats',
  'jobs',
  'supervisors',
  'petOwnerStore',
  'veterinarianStore',
  'users',
  'userMessages',
  'broadcasts',
];

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('admin dashboard summary — GET /admin/dashboard/summary', () => {
  it('returns all 23 category cards, recent activity and pending tasks for an admin', async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    // Give the summary at least one real, non-zero count and one recent-activity row to check shape against.
    await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Dashboard Test Clinic',
    });

    const res = await request(app)
      .get('/api/v1/admin/dashboard/summary')
      .set(bearer(admin.accessToken));

    expect(res.status).toBe(200);
    const { cards, recentActivity, pendingTasks } = res.body.data;

    expect(Array.isArray(cards)).toBe(true);
    const cardIds = cards.map((c: { id: string }) => c.id);
    for (const id of EXPECTED_CARD_IDS) {
      expect(cardIds).toContain(id);
    }
    expect(cardIds.length).toBe(EXPECTED_CARD_IDS.length);
    for (const card of cards) {
      expect(typeof card.count).toBe('number');
      expect(card.count).toBeGreaterThanOrEqual(0);
    }
    const clinics = cards.find((c: { id: string }) => c.id === 'clinics');
    expect(clinics.count).toBeGreaterThanOrEqual(1);

    expect(Array.isArray(recentActivity)).toBe(true);
    expect(recentActivity.length).toBeGreaterThanOrEqual(1);
    expect(recentActivity[0]).toHaveProperty('action');
    expect(recentActivity[0]).toHaveProperty('actorName');

    expect(Array.isArray(pendingTasks)).toBe(true);
    for (const task of pendingTasks) {
      expect(['VET_APPLICATION', 'ORGANIZATION_APPROVAL', 'SUBSCRIPTION_RENEWAL']).toContain(
        task.kind,
      );
      expect(['urgent', 'medium', 'low']).toContain(task.priority);
      expect(typeof task.label).toBe('string');
    }
  });

  it('allows a MODERATOR (granted dashboard.admin.read)', async () => {
    const moderator = await registerModerator(app);
    const res = await request(app)
      .get('/api/v1/admin/dashboard/summary')
      .set(bearer(moderator.accessToken));
    expect(res.status).toBe(200);
  });

  it('rejects a plain authenticated user', async () => {
    const user = await registerUser(app);
    const res = await request(app)
      .get('/api/v1/admin/dashboard/summary')
      .set(bearer(user.accessToken));
    expect(res.status).toBe(403);
  });
});

describe('admin dashboard card counts — new/unseen, not totals (spec §4-§8)', () => {
  it('resets a card to 0 after it is marked seen, and counts only new rows afterward', async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);

    await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Unseen Count Clinic',
    });

    const before = await request(app)
      .get('/api/v1/admin/dashboard/summary')
      .set(bearer(admin.accessToken));
    const clinicsBefore = before.body.data.cards.find((c: { id: string }) => c.id === 'clinics');
    expect(clinicsBefore.count).toBeGreaterThanOrEqual(1);

    const seenRes = await request(app)
      .post('/api/v1/admin/dashboard/cards/clinics/seen')
      .set(bearer(admin.accessToken));
    expect(seenRes.status).toBe(200);

    const after = await request(app)
      .get('/api/v1/admin/dashboard/summary')
      .set(bearer(admin.accessToken));
    const clinicsAfter = after.body.data.cards.find((c: { id: string }) => c.id === 'clinics');
    expect(clinicsAfter.count).toBe(0);

    // A different card, never opened, is unaffected by marking "clinics" seen.
    const officesAfter = after.body.data.cards.find((c: { id: string }) => c.id === 'offices');
    expect(officesAfter.count).toBe(0);

    // A genuinely new clinic arriving after the seen-cursor bumps the count back up.
    await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Second Unseen Count Clinic',
    });
    const afterNew = await request(app)
      .get('/api/v1/admin/dashboard/summary')
      .set(bearer(admin.accessToken));
    const clinicsAfterNew = afterNew.body.data.cards.find((c: { id: string }) => c.id === 'clinics');
    expect(clinicsAfterNew.count).toBe(1);
  });

  it('rejects an unknown card id', async () => {
    const admin = await registerAdmin(app);
    const res = await request(app)
      .post('/api/v1/admin/dashboard/cards/not-a-real-card/seen')
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(422);
  });
});
