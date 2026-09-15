import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  listChatMessages,
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

/**
 * "المحادثات" — the Veterinary Office Dashboard's org-scoped conversations screen.
 * `PET_OWNER_VETERINARY_OFFICE` mirrors `PET_OWNER_CLINIC` exactly: the office side is
 * resolved live from ACTIVE membership (no participant row), any ACTIVE member may act on
 * behalf of the office, and `GET /conversations?organizationId=` already lists it.
 */
describe('veterinary office chat — Pet Owner ↔ Veterinary Office', () => {
  it('a pet owner starts a conversation with the office; the office can reply as any ACTIVE member', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const petOwner = await registerUser(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });

    const conv = await startConversation(app, petOwner.accessToken, office.id);
    expect(conv.type).toBe('PET_OWNER_VETERINARY_OFFICE');
    expect(conv.organizationId).toBe(office.id);

    await sendChatMessage(app, petOwner.accessToken, conv.id, 'هل هذا الدواء متوفر؟');
    const officeReply = await sendChatMessage(app, owner.accessToken, conv.id, 'نعم متوفر');
    expect(officeReply.status).toBe(201);

    const messages = await listChatMessages(app, petOwner.accessToken, conv.id);
    expect(messages.status).toBe(200);
    expect(messages.body.data).toHaveLength(2);
  });

  it('re-opening the same pet owner ↔ office pair returns the SAME conversation (one relationship, not one per message)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const petOwner = await registerUser(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });

    const first = await startConversation(app, petOwner.accessToken, office.id);
    const second = await startConversation(app, petOwner.accessToken, office.id);
    expect(second.id).toBe(first.id);
  });

  it('GET /conversations?organizationId= lists it for an ACTIVE office member (the Dashboard "المحادثات" screen)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const petOwner = await registerUser(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    const conv = await startConversation(app, petOwner.accessToken, office.id);

    const res = await request(app)
      .get('/api/v1/conversations')
      .query({ organizationId: office.id })
      .set(bearer(owner.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: { id: string }) => c.id)).toContain(conv.id);
  });

  it('an unrelated user cannot read the conversation (404, not 403 — no id leak)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const petOwner = await registerUser(app);
    const stranger = await registerUser(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    const conv = await startConversation(app, petOwner.accessToken, office.id);

    const res = await request(app)
      .get(`/api/v1/conversations/${conv.id}`)
      .set(bearer(stranger.accessToken));
    expect(res.status).toBe(404);
  });
});
