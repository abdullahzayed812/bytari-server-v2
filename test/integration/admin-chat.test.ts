import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  startConversation,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('admin chat oversight — GET /admin/chat/conversations', () => {
  it('lists every conversation platform-wide for an admin, newest activity first', async () => {
    const admin = await registerAdmin(app);
    const vetOwner = await registerApprovedVet(app);
    const petOwner = await registerUser(app);
    const clinic = await createActiveOrganization(app, vetOwner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'Oversight Test Clinic',
    });
    const conversation = await startConversation(app, petOwner.accessToken, clinic.id);

    const res = await request(app)
      .get('/api/v1/admin/chat/conversations')
      .set(bearer(admin.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.map((c: { id: string }) => c.id)).toContain(conversation.id);
  });

  it('rejects a caller without the chat.read oversight permission', async () => {
    const petOwner = await registerUser(app);
    const res = await request(app)
      .get('/api/v1/admin/chat/conversations')
      .set(bearer(petOwner.accessToken));
    expect(res.status).toBe(403);
  });
});
