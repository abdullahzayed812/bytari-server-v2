import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { bearer, createSyndicate, registerAdmin, registerUser } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const api = (p: string): string => `/api/v1/syndicates${p}`;

interface ServiceItem {
  id: string;
  serviceKey: string;
  title: string | null;
  description: string | null;
  isEnabled: boolean;
}

async function setup() {
  const admin = await registerAdmin(app);
  const syndicate = await createSyndicate(app, admin.accessToken, { name: 'نقابة البيطريين' });
  const syndicateAdmin = await registerUser(app);
  const res = await request(app)
    .post(api(`/${syndicate.id}/admins`))
    .set(bearer(admin.accessToken))
    .send({ email: syndicateAdmin.email });
  expect(res.status).toBe(201);
  return { admin, syndicateAdmin, syndicateId: syndicate.id };
}

async function listServices(token: string, syndicateId: string): Promise<ServiceItem[]> {
  const res = await request(app)
    .get(api(`/${syndicateId}/services`))
    .set(bearer(token));
  expect(res.status).toBe(200);
  return res.body.data as ServiceItem[];
}

describe('syndicate services ("الخدمات")', () => {
  it('lists the six services of a syndicate, readable by any authenticated user', async () => {
    const { syndicateId } = await setup();
    const viewer = await registerUser(app);
    const items = await listServices(viewer.accessToken, syndicateId);
    expect(items.map((i) => i.serviceKey)).toEqual([
      'ID_CARD',
      'INQUIRY',
      'ANNOUNCEMENTS',
      'REGISTER_DOCTORS',
      'LEGAL_SUPPORT',
      'OFFICE_LICENSES',
    ]);
    expect(items.every((i) => i.title === null && i.description === null && i.isEnabled)).toBe(
      true,
    );
    // Reading again never duplicates them.
    expect(await listServices(viewer.accessToken, syndicateId)).toHaveLength(6);
  });

  it('a syndicate manager edits a service in place — same id, no duplicate — and the change is visible to everyone', async () => {
    const { syndicateAdmin, syndicateId } = await setup();
    const [, , , , legal] = await listServices(syndicateAdmin.accessToken, syndicateId);

    const res = await request(app)
      .patch(api(`/${syndicateId}/services/${legal!.id}`))
      .set(bearer(syndicateAdmin.accessToken))
      .send({ title: 'الاستشارات القانونية', description: 'نص الخدمة الجديد', isEnabled: false });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: legal!.id,
      serviceKey: 'LEGAL_SUPPORT',
      title: 'الاستشارات القانونية',
      description: 'نص الخدمة الجديد',
      isEnabled: false,
    });

    const viewer = await registerUser(app);
    const after = await listServices(viewer.accessToken, syndicateId);
    expect(after).toHaveLength(6);
    expect(after.find((i) => i.id === legal!.id)).toMatchObject({
      title: 'الاستشارات القانونية',
      isEnabled: false,
    });
    expect(
      await getTestDb()('syndicate_services').where({ organization_id: syndicateId }),
    ).toHaveLength(6);

    // A blank title goes back to the app default (NULL); other fields stay.
    const reset = await request(app)
      .patch(api(`/${syndicateId}/services/${legal!.id}`))
      .set(bearer(syndicateAdmin.accessToken))
      .send({ title: '' });
    expect(reset.body.data).toMatchObject({ title: null, description: 'نص الخدمة الجديد' });

    const audit = await getTestDb()('audit_logs')
      .where({ entity_id: legal!.id, action: 'SYNDICATE_SERVICE_UPDATED' })
      .first();
    expect(audit).toBeTruthy();
  });

  it('only syndicate managers may edit; a service of another syndicate cannot be edited through this one', async () => {
    const { admin, syndicateAdmin, syndicateId } = await setup();
    const [first] = await listServices(syndicateAdmin.accessToken, syndicateId);

    const stranger = await registerUser(app);
    const denied = await request(app)
      .patch(api(`/${syndicateId}/services/${first!.id}`))
      .set(bearer(stranger.accessToken))
      .send({ title: 'x' });
    expect(denied.status).toBe(403);

    // Global admin may edit (ADMIN override).
    const byAdmin = await request(app)
      .patch(api(`/${syndicateId}/services/${first!.id}`))
      .set(bearer(admin.accessToken))
      .send({ description: 'من الإدارة' });
    expect(byAdmin.status).toBe(200);

    const other = await createSyndicate(app, admin.accessToken, { name: 'نقابة أخرى' });
    const [otherFirst] = await listServices(admin.accessToken, other.id);
    const crossed = await request(app)
      .patch(api(`/${syndicateId}/services/${otherFirst!.id}`))
      .set(bearer(syndicateAdmin.accessToken))
      .send({ title: 'x' });
    expect(crossed.status).toBe(404);

    const invalid = await request(app)
      .patch(api(`/${syndicateId}/services/${first!.id}`))
      .set(bearer(syndicateAdmin.accessToken))
      .send({ title: 'x'.repeat(121) });
    expect(invalid.status).toBe(422);
    const empty = await request(app)
      .patch(api(`/${syndicateId}/services/${first!.id}`))
      .set(bearer(syndicateAdmin.accessToken))
      .send({});
    expect(empty.status).toBe(422);
  });
});
