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
  sendChatMessage,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

describe('Veterinary Office dashboard — unread messages badge', () => {
  it('counts unread customer messages per office member; reading clears it; outsiders get nothing', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const customer = await registerUser(app);
    const outsider = await registerUser(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    const conv = await request(app)
      .post(`/api/v1/organizations/${office.id}/conversations`)
      .set(bearer(customer.accessToken))
      .send({});
    expect([200, 201]).toContain(conv.status);
    const convId = conv.body.data.id as string;
    await sendChatMessage(app, customer.accessToken, convId, 'هل يتوفر اللقاح؟');
    const last = await sendChatMessage(app, customer.accessToken, convId, 'وما سعره؟');
    await tick();

    const summary = (token: string) =>
      request(app)
        .get(`/api/v1/conversations/unread-summary?organizationId=${office.id}`)
        .set(bearer(token));

    const before = await summary(owner.accessToken);
    expect(before.status).toBe(200);
    expect(before.body.data).toEqual({ unreadConversations: 1, unreadMessages: 2 });

    const list = await request(app)
      .get(`/api/v1/conversations?organizationId=${office.id}`)
      .set(bearer(owner.accessToken));
    expect(list.body.data[0].unreadCount).toBe(2);

    // an outsider sees no office conversations at all
    expect((await summary(outsider.accessToken)).body.data).toEqual({
      unreadConversations: 0,
      unreadMessages: 0,
    });

    await request(app)
      .post(`/api/v1/conversations/${convId}/read`)
      .set(bearer(owner.accessToken))
      .send({ messageId: last.body.data.id });
    expect((await summary(owner.accessToken)).body.data).toEqual({
      unreadConversations: 0,
      unreadMessages: 0,
    });
  });
});
