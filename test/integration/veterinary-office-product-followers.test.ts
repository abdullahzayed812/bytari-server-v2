import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
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

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

describe('Veterinary Office — new product notifies followers', () => {
  it('every follower (not the creator, not non-followers) gets VETERINARY_OFFICE_PRODUCT_ADDED', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const follower = await registerUser(app);
    const stranger = await registerUser(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    await request(app)
      .post(`/api/v1/organizations/${office.id}/follow`)
      .set(bearer(follower.accessToken));
    // the owner follows their own office too — never notified of their own product
    await request(app)
      .post(`/api/v1/organizations/${office.id}/follow`)
      .set(bearer(owner.accessToken));

    const created = await request(app)
      .post(`/api/v1/organizations/${office.id}/office-products`)
      .set(bearer(owner.accessToken))
      .send({ name: 'لقاح نيوكاسل', productType: 'MEDICINE', price: '15000', stockQuantity: 5 });
    expect(created.status).toBe(201);
    await tick();

    const mine = await listNotifications(app, follower.accessToken);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({
      type: 'VETERINARY_OFFICE_PRODUCT_ADDED',
      title: 'منتج جديد',
    });
    expect(mine.body.data[0].data).toMatchObject({
      organizationId: office.id,
      productId: created.body.data.id,
    });

    expect((await listNotifications(app, stranger.accessToken)).body.data).toHaveLength(0);
    const ownerNotifs = (await listNotifications(app, owner.accessToken)).body.data as {
      type: string;
    }[];
    expect(ownerNotifs.filter((n) => n.type === 'VETERINARY_OFFICE_PRODUCT_ADDED')).toHaveLength(0);
  });
});
