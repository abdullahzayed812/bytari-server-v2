import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  createVeterinaryOfficeProduct,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const pPath = (orgId: string, id?: string): string =>
  `/api/v1/organizations/${orgId}/office-products${id ? `/${id}` : ''}`;
const publicPPath = (orgId: string, id?: string): string =>
  `/api/v1/organizations/discover/${orgId}/office-products${id ? `/${id}` : ''}`;

async function setup() {
  const admin = await registerAdmin(app);
  const owner = await registerApprovedVet(app);
  const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
    type: 'VETERINARY_OFFICE',
    name: 'Currency Office',
  });
  return { owner, office };
}

describe('veterinary office products — price currency (Dinar / US Dollar)', () => {
  it('defaults to IQD when no currency is sent', async () => {
    const { owner, office } = await setup();
    const p = await createVeterinaryOfficeProduct(app, owner.accessToken, office.id, {
      price: '25000',
    });
    const read = await request(app).get(pPath(office.id, p.id)).set(bearer(owner.accessToken));
    expect(read.body.data).toMatchObject({ price: '25000.00', currency: 'IQD' });
  });

  it('stores USD on create, returns it everywhere, and can be switched on edit', async () => {
    const { owner, office } = await setup();
    const create = await request(app).post(pPath(office.id)).set(bearer(owner.accessToken)).send({
      name: 'Imported vaccine',
      productType: 'MEDICINE',
      price: '12.50',
      currency: 'USD',
    });
    expect(create.status).toBe(201);
    const id = create.body.data.id as string;
    expect(create.body.data).toMatchObject({ price: '12.50', currency: 'USD' });
    expect((await getTestDb()('veterinary_office_products').where({ id }).first()).currency).toBe(
      'USD',
    );

    const list = await request(app).get(pPath(office.id)).set(bearer(owner.accessToken));
    expect(list.body.data[0]).toMatchObject({ id, currency: 'USD' });

    const stranger = await registerUser(app);
    const pub = await request(app)
      .get(publicPPath(office.id, id))
      .set(bearer(stranger.accessToken));
    expect(pub.status).toBe(200);
    expect(pub.body.data).toMatchObject({ price: '12.50', currency: 'USD' });
    const pubList = await request(app)
      .get(publicPPath(office.id))
      .set(bearer(stranger.accessToken));
    expect(pubList.body.data[0]).toMatchObject({ id, currency: 'USD' });

    const edit = await request(app)
      .patch(pPath(office.id, id))
      .set(bearer(owner.accessToken))
      .send({ currency: 'IQD', price: '18000' });
    expect(edit.status).toBe(200);
    expect(edit.body.data).toMatchObject({ price: '18000.00', currency: 'IQD' });

    // Editing other fields leaves the currency alone.
    const rename = await request(app)
      .patch(pPath(office.id, id))
      .set(bearer(owner.accessToken))
      .send({ name: 'Renamed' });
    expect(rename.body.data.currency).toBe('IQD');
  });

  it('rejects an unsupported currency on create and edit', async () => {
    const { owner, office } = await setup();
    const bad = await request(app).post(pPath(office.id)).set(bearer(owner.accessToken)).send({
      name: 'X',
      productType: 'MEDICINE',
      price: '10',
      currency: 'EUR',
    });
    expect([400, 422]).toContain(bad.status);

    const p = await createVeterinaryOfficeProduct(app, owner.accessToken, office.id);
    const badEdit = await request(app)
      .patch(pPath(office.id, p.id))
      .set(bearer(owner.accessToken))
      .send({ currency: 'usd' });
    expect([400, 422]).toContain(badEdit.status);
  });

  it('the database refuses any other currency value (legacy-safe CHECK)', async () => {
    const { owner, office } = await setup();
    const p = await createVeterinaryOfficeProduct(app, owner.accessToken, office.id);
    await expect(
      getTestDb()('veterinary_office_products').where({ id: p.id }).update({ currency: 'SAR' }),
    ).rejects.toThrow(/chk_vop_currency/);
  });
});
