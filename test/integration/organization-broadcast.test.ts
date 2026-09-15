import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  assignOrganizationSupervisor,
  bearer,
  createActiveOrganization,
  listNotifications,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

function follow(actorToken: string, organizationId: string) {
  return request(app)
    .post(`/api/v1/organizations/${organizationId}/follow`)
    .set(bearer(actorToken));
}

function sendBroadcast(actorToken: string, organizationId: string, body: Record<string, unknown>) {
  return request(app)
    .post(`/api/v1/organizations/${organizationId}/broadcast`)
    .set(bearer(actorToken))
    .send(body);
}

/** "إرسال رسالة للمتابعين" — Veterinary Office Dashboard broadcast to followers. */
describe('organization broadcast — send message to followers', () => {
  it('the owner sends a broadcast; every follower (not the sender) gets a notification with the sent title/body', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const followerA = await registerUser(app);
    const followerB = await registerUser(app);
    const nonFollower = await registerUser(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    await follow(followerA.accessToken, office.id);
    await follow(followerB.accessToken, office.id);

    const send = await sendBroadcast(owner.accessToken, office.id, {
      title: 'عرض خاص',
      body: 'خصم 20% على جميع المنتجات هذا الأسبوع',
    });
    expect(send.status).toBe(201);
    await tick();

    const notifsA = await listNotifications(app, followerA.accessToken);
    expect(notifsA.body.data).toHaveLength(1);
    expect(notifsA.body.data[0].type).toBe('ORGANIZATION_BROADCAST');
    expect(notifsA.body.data[0].title).toBe('عرض خاص');
    expect(notifsA.body.data[0].body).toBe('خصم 20% على جميع المنتجات هذا الأسبوع');

    const notifsB = await listNotifications(app, followerB.accessToken);
    expect(notifsB.body.data).toHaveLength(1);

    const notifsNonFollower = await listNotifications(app, nonFollower.accessToken);
    expect(notifsNonFollower.body.data).toHaveLength(0);
  });

  it('a plain STAFF/VETERINARIAN member without the grant cannot send a broadcast', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const staff = await registerUser(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    await request(app)
      .post(`/api/v1/organizations/${office.id}/members`)
      .set(bearer(owner.accessToken))
      .send({ userId: staff.id, role: 'STAFF' });

    const res = await sendBroadcast(staff.accessToken, office.id, {
      title: 'x',
      body: 'y',
    });
    expect(res.status).toBe(403);
  });

  it('a supervisor explicitly granted organization.broadcast.send can send one', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const supervisor = await registerApprovedVet(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    await assignOrganizationSupervisor(app, owner.accessToken, office.id, {
      userId: supervisor.id,
      permissions: ['organization.broadcast.send'],
    });

    const res = await sendBroadcast(supervisor.accessToken, office.id, {
      title: 'a',
      body: 'b',
    });
    expect(res.status).toBe(201);
  });

  it('an unrelated authenticated user cannot send a broadcast', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const stranger = await registerUser(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });

    const res = await sendBroadcast(stranger.accessToken, office.id, { title: 'a', body: 'b' });
    expect(res.status).toBe(403);
  });
});
