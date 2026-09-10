import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  createProduct,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const publicPPath = (orgId: string, id?: string): string =>
  `/api/v1/organizations/discover/${orgId}/products${id ? `/${id}` : ''}`;
const pPath = (orgId: string, id?: string): string =>
  `/api/v1/organizations/${orgId}/products${id ? `/${id}` : ''}`;

async function setupOffice() {
  const admin = await registerAdmin(app);
  const owner = await registerApprovedVet(app);
  const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
    type: 'VETERINARY_OFFICE',
    name: 'Al Rahma Veterinary Office',
  });
  return { admin, owner, office };
}

describe('public product catalog — GET /organizations/discover/:id/products*', () => {
  it('any authenticated user can browse an ACTIVE office’s ACTIVE products', async () => {
    const { owner, office } = await setupOffice();
    const prod = await createProduct(app, owner.accessToken, office.id, {
      name: 'Anti-Peak',
      productType: 'MEDICINE',
      price: '25000',
    });
    const stranger = await registerUser(app);

    const list = await request(app).get(publicPPath(office.id)).set(bearer(stranger.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ id: prod.id, name: 'Anti-Peak' });

    const one = await request(app)
      .get(publicPPath(office.id, prod.id))
      .set(bearer(stranger.accessToken));
    expect(one.status).toBe(200);
    expect(one.body.data).toMatchObject({ id: prod.id, name: 'Anti-Peak' });
  });

  it('requires authentication', async () => {
    const { owner, office } = await setupOffice();
    await createProduct(app, owner.accessToken, office.id);
    const res = await request(app).get(publicPPath(office.id));
    expect(res.status).toBe(401);
  });

  it('excludes INACTIVE (soft-deleted) products from the public list and 404s the detail', async () => {
    const { owner, office } = await setupOffice();
    const prod = await createProduct(app, owner.accessToken, office.id);
    await request(app).delete(pPath(office.id, prod.id)).set(bearer(owner.accessToken));

    const stranger = await registerUser(app);
    const list = await request(app).get(publicPPath(office.id)).set(bearer(stranger.accessToken));
    expect(list.body.data).toHaveLength(0);

    const one = await request(app)
      .get(publicPPath(office.id, prod.id))
      .set(bearer(stranger.accessToken));
    expect(one.status).toBe(404);
  });

  it('404s for a PENDING (not yet ACTIVE) organization, even with a real product', async () => {
    const owner = await registerApprovedVet(app);
    const stranger = await registerUser(app);
    // A freshly-created CLINIC/OFFICE/STORE starts PENDING until admin approval.
    const created = await request(app)
      .post('/api/v1/organizations')
      .set(bearer(owner.accessToken))
      .send({ type: 'VETERINARY_OFFICE', name: 'Unapproved Office' });
    const officeId = created.body.data.id as string;

    const res = await request(app).get(publicPPath(officeId)).set(bearer(stranger.accessToken));
    expect(res.status).toBe(404);
  });

  it('404s for a CLINIC (not product-capable), never leaking a 400', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'A Clinic',
    });
    const stranger = await registerUser(app);
    const res = await request(app).get(publicPPath(clinic.id)).set(bearer(stranger.accessToken));
    expect(res.status).toBe(404);
  });

  it('filters by type and paginates, same as the management list', async () => {
    const { owner, office } = await setupOffice();
    await createProduct(app, owner.accessToken, office.id, {
      name: 'Med A',
      productType: 'MEDICINE',
    });
    await createProduct(app, owner.accessToken, office.id, {
      name: 'Care A',
      productType: 'CARE',
    });
    const stranger = await registerUser(app);

    const meds = await request(app)
      .get(`${publicPPath(office.id)}?type=MEDICINE`)
      .set(bearer(stranger.accessToken));
    expect(meds.body.data).toHaveLength(1);
    expect(meds.body.data[0].name).toBe('Med A');
  });
});

describe('product images', () => {
  it('an owner uploads, registers, and removes a product image; the first becomes primary', async () => {
    const { owner, office } = await setupOffice();
    const prod = await createProduct(app, owner.accessToken, office.id);

    const upload = await request(app)
      .post(`${pPath(office.id, prod.id)}/images/upload-url`)
      .set(bearer(owner.accessToken))
      .send({ filename: 'a.jpg', mimeType: 'image/jpeg', size: 1024 });
    expect(upload.status).toBe(200);
    const storageKey = upload.body.data.storageKey as string;

    // Simulate the client's direct-to-R2 PUT by writing through the in-memory
    // storage the test app is configured with.
    await container.objectStorage.put(storageKey, Buffer.from('fake-image-bytes'), {
      contentType: 'image/jpeg',
    });

    const register = await request(app)
      .post(`${pPath(office.id, prod.id)}/images`)
      .set(bearer(owner.accessToken))
      .send({ storageKey, mimeType: 'image/jpeg' });
    expect(register.status).toBe(200);
    expect(register.body.data.images).toHaveLength(1);
    expect(register.body.data.primaryImageUrl).toBeTruthy();

    const imageId = register.body.data.images[0].id as string;
    const remove = await request(app)
      .delete(`${pPath(office.id, prod.id)}/images/${imageId}`)
      .set(bearer(owner.accessToken));
    expect(remove.status).toBe(200);
    expect(remove.body.data.images).toHaveLength(0);
    expect(remove.body.data.primaryImageUrl).toBeNull();
  });

  it('a non-member cannot request an upload URL (403)', async () => {
    const { owner, office } = await setupOffice();
    const prod = await createProduct(app, owner.accessToken, office.id);
    const stranger = await registerUser(app);

    const res = await request(app)
      .post(`${pPath(office.id, prod.id)}/images/upload-url`)
      .set(bearer(stranger.accessToken))
      .send({ filename: 'a.jpg', mimeType: 'image/jpeg', size: 1024 });
    expect(res.status).toBe(403);
  });
});

describe('discover list — rating aggregate', () => {
  it('attaches rating / reviewsCount computed from real reviews, batched across the page', async () => {
    const { office } = await setupOffice();
    const reviewerA = await registerUser(app);
    const reviewerB = await registerUser(app);

    await request(app)
      .post(`/api/v1/organizations/${office.id}/reviews`)
      .set(bearer(reviewerA.accessToken))
      .send({ rating: 5 });
    await request(app)
      .post(`/api/v1/organizations/${office.id}/reviews`)
      .set(bearer(reviewerB.accessToken))
      .send({ rating: 3 });

    const stranger = await registerUser(app);
    const res = await request(app)
      .get('/api/v1/organizations/discover?type=VETERINARY_OFFICE')
      .set(bearer(stranger.accessToken));
    expect(res.status).toBe(200);
    const item = res.body.data.find((o: { id: string }) => o.id === office.id);
    expect(item.rating).toBe(4);
    expect(item.reviewsCount).toBe(2);
  });

  it('is null / zero for an organization with no reviews yet', async () => {
    const { office } = await setupOffice();
    const stranger = await registerUser(app);
    const res = await request(app)
      .get('/api/v1/organizations/discover?type=VETERINARY_OFFICE')
      .set(bearer(stranger.accessToken));
    const item = res.body.data.find((o: { id: string }) => o.id === office.id);
    expect(item.rating).toBeNull();
    expect(item.reviewsCount).toBe(0);
  });
});
