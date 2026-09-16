import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
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

/**
 * "إخفاء/إظهار" (hide/show) — orthogonal to status/delete (`is_hidden`, distinct from
 * `status: INACTIVE`, which is the pre-existing soft-delete state).
 */
describe('veterinary office product — hide/show is orthogonal to delete', () => {
  it('hiding a product keeps it ACTIVE but excludes it from the public catalog', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const buyer = await registerUser(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    const product = await createVeterinaryOfficeProduct(app, owner.accessToken, office.id);

    const hide = await request(app)
      .patch(`/api/v1/organizations/${office.id}/office-products/${product.id}`)
      .set(bearer(owner.accessToken))
      .send({ isHidden: true });
    expect(hide.status).toBe(200);
    expect(hide.body.data.isHidden).toBe(true);
    expect(hide.body.data.status).toBe('ACTIVE');

    const publicList = await request(app)
      .get(`/api/v1/organizations/discover/${office.id}/office-products`)
      .set(bearer(buyer.accessToken));
    expect(publicList.body.data.map((p: { id: string }) => p.id)).not.toContain(product.id);

    const publicDetail = await request(app)
      .get(`/api/v1/organizations/discover/${office.id}/office-products/${product.id}`)
      .set(bearer(buyer.accessToken));
    expect(publicDetail.status).toBe(404);

    // Still visible to the owner's management list.
    const ownerList = await request(app)
      .get(`/api/v1/organizations/${office.id}/office-products`)
      .set(bearer(owner.accessToken));
    expect(ownerList.body.data.map((p: { id: string }) => p.id)).toContain(product.id);
  });

  it('the "hidden products" filter returns only hidden products', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    const hidden = await createVeterinaryOfficeProduct(app, owner.accessToken, office.id, {
      name: 'Hidden one',
    });
    const visible = await createVeterinaryOfficeProduct(app, owner.accessToken, office.id, {
      name: 'Visible one',
    });
    await request(app)
      .patch(`/api/v1/organizations/${office.id}/office-products/${hidden.id}`)
      .set(bearer(owner.accessToken))
      .send({ isHidden: true });

    const hiddenList = await request(app)
      .get(`/api/v1/organizations/${office.id}/office-products?hidden=true`)
      .set(bearer(owner.accessToken));
    const ids = hiddenList.body.data.map((p: { id: string }) => p.id);
    expect(ids).toContain(hidden.id);
    expect(ids).not.toContain(visible.id);
  });

  it('the "?hidden=false" filter returns only non-hidden products (regression: z.coerce.boolean would invert this)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    const hidden = await createVeterinaryOfficeProduct(app, owner.accessToken, office.id, {
      name: 'Hidden two',
    });
    const visible = await createVeterinaryOfficeProduct(app, owner.accessToken, office.id, {
      name: 'Visible two',
    });
    await request(app)
      .patch(`/api/v1/organizations/${office.id}/office-products/${hidden.id}`)
      .set(bearer(owner.accessToken))
      .send({ isHidden: true });

    const visibleList = await request(app)
      .get(`/api/v1/organizations/${office.id}/office-products?hidden=false`)
      .set(bearer(owner.accessToken));
    const ids = visibleList.body.data.map((p: { id: string }) => p.id);
    expect(ids).toContain(visible.id);
    expect(ids).not.toContain(hidden.id);
  });

  it('showing a hidden product again restores it to the public catalog', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const buyer = await registerUser(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    const product = await createVeterinaryOfficeProduct(app, owner.accessToken, office.id);
    await request(app)
      .patch(`/api/v1/organizations/${office.id}/office-products/${product.id}`)
      .set(bearer(owner.accessToken))
      .send({ isHidden: true });

    const show = await request(app)
      .patch(`/api/v1/organizations/${office.id}/office-products/${product.id}`)
      .set(bearer(owner.accessToken))
      .send({ isHidden: false });
    expect(show.body.data.isHidden).toBe(false);

    const publicDetail = await request(app)
      .get(`/api/v1/organizations/discover/${office.id}/office-products/${product.id}`)
      .set(bearer(buyer.accessToken));
    expect(publicDetail.status).toBe(200);
  });

  it('deleting (deactivating) a product is independent of hidden state', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
    });
    const product = await createVeterinaryOfficeProduct(app, owner.accessToken, office.id);

    const del = await request(app)
      .delete(`/api/v1/organizations/${office.id}/office-products/${product.id}`)
      .set(bearer(owner.accessToken));
    expect(del.status).toBe(200);
    expect(del.body.data.status).toBe('INACTIVE');
    expect(del.body.data.isHidden).toBe(false);
  });
});
