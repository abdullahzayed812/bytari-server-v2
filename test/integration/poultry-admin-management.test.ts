import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  approveTraderAsAdmin,
  bearer,
  registerAdmin,
  registerUser,
  submitTraderRegistration,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('poultry admin — trader management', () => {
  it('admin edits a trader registration and removes it (ads taken down, user may re-register)', async () => {
    const admin = await registerAdmin(app);
    const trader = await registerUser(app);
    expect((await submitTraderRegistration(app, trader.accessToken)).status).toBe(201);
    await approveTraderAsAdmin(app, admin.accessToken, trader.id);

    const edit = await request(app)
      .patch(`/api/v1/admin/traders/${trader.id}`)
      .set(bearer(admin.accessToken))
      .send({ displayName: 'تاجر محدّث', governorate: 'البصرة' });
    expect(edit.status).toBe(200);
    expect(edit.body.data.displayName).toBe('تاجر محدّث');

    await getTestDb()('poultry_offers').insert({
      trader_user_id: trader.id,
      quantity: 100,
      price: '2500',
      governorate: 'البصرة',
      phone: '07700000000',
    });

    const plain = await registerUser(app);
    expect(
      (
        await request(app)
          .delete(`/api/v1/admin/traders/${trader.id}`)
          .set(bearer(plain.accessToken))
      ).status,
    ).toBe(403);

    const del = await request(app)
      .delete(`/api/v1/admin/traders/${trader.id}`)
      .set(bearer(admin.accessToken));
    expect(del.status).toBe(200);

    const user = await getTestDb()('users').where({ id: trader.id }).first('trader_status');
    expect(user.trader_status).toBe('NOT_REGISTERED');
    const offers = await getTestDb()('poultry_offers').where({ trader_user_id: trader.id });
    expect(offers.every((o: { status: string }) => o.status === 'REMOVED')).toBe(true);
    expect(
      (await request(app).get(`/api/v1/admin/traders/${trader.id}`).set(bearer(admin.accessToken)))
        .status,
    ).toBe(404);

    // They may register again from scratch.
    const relogin = await submitTraderRegistration(app, trader.accessToken);
    expect(relogin.status).toBe(201);
  });
});
