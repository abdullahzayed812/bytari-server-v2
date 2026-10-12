import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  createVeterinaryOfficeProduct,
  fixtureBytes,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

/**
 * Veterinary Office product images:
 *  - a cover image can be uploaded on the "add product" form (org-level
 *    presign) and attached atomically by `POST …/office-products` (`image`);
 *  - an image can be replaced (`PUT …/images/:imageId`) — upload first, swap
 *    atomically, delete the old object only after the commit and only when
 *    nothing references it; a failed / missing upload keeps the old image.
 */
const { app, container } = buildTestApp();
const storage = container.objectStorage;

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const pPath = (orgId: string, id?: string): string =>
  `/api/v1/organizations/${orgId}/office-products${id ? `/${id}` : ''}`;

async function setupOffice() {
  const admin = await registerAdmin(app);
  const owner = await registerApprovedVet(app);
  const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
    type: 'VETERINARY_OFFICE',
    name: 'Image Office',
  });
  return { admin, owner, office };
}

/** Presign at `url`, then simulate the client's direct-to-R2 PUT. */
async function upload(token: string, url: string, put = true): Promise<string> {
  const res = await request(app)
    .post(url)
    .set(bearer(token))
    .send({ filename: 'p.jpg', mimeType: 'image/jpeg', size: 1024 });
  expect(res.status).toBe(200);
  const storageKey = res.body.data.storageKey as string;
  if (put) {
    await storage.put(storageKey, fixtureBytes('image/jpeg', 1024), { contentType: 'image/jpeg' });
  }
  return storageKey;
}

describe('product image at creation', () => {
  it('uploads before the product exists and attaches it as the primary image on create', async () => {
    const { owner, office } = await setupOffice();
    const key = await upload(owner.accessToken, `${pPath(office.id)}/images/upload-url`);

    const res = await request(app)
      .post(pPath(office.id))
      .set(bearer(owner.accessToken))
      .send({
        name: 'Wormer',
        productType: 'MEDICINE',
        image: { storageKey: key, mimeType: 'image/jpeg' },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.primaryImageUrl).toBeTruthy();
    expect(res.body.data.images).toEqual([
      expect.objectContaining({ isPrimary: true, sortOrder: 0 }),
    ]);
    expect(JSON.stringify(res.body)).not.toContain('"storageKey"');
    const row = await getTestDb()('veterinary_office_products')
      .where({ id: res.body.data.id })
      .first();
    expect(row.primary_image_key).toBe(key);
  });

  it('creates without an image exactly as before', async () => {
    const { owner, office } = await setupOffice();
    const res = await request(app)
      .post(pPath(office.id))
      .set(bearer(owner.accessToken))
      .send({ name: 'Plain', productType: 'MEDICINE' });
    expect(res.status).toBe(201);
    expect(res.body.data.images).toEqual([]);
    expect(res.body.data.primaryImageUrl).toBeNull();
  });

  it('rejects a missing upload / a reused key without creating a product', async () => {
    const { owner, office } = await setupOffice();
    const missing = await upload(owner.accessToken, `${pPath(office.id)}/images/upload-url`, false);
    const noObject = await request(app)
      .post(pPath(office.id))
      .set(bearer(owner.accessToken))
      .send({
        name: 'X',
        productType: 'MEDICINE',
        image: { storageKey: missing, mimeType: 'image/jpeg' },
      });
    expect(noObject.status).toBe(400);

    const key = await upload(owner.accessToken, `${pPath(office.id)}/images/upload-url`);
    const first = await request(app)
      .post(pPath(office.id))
      .set(bearer(owner.accessToken))
      .send({
        name: 'A',
        productType: 'MEDICINE',
        image: { storageKey: key, mimeType: 'image/jpeg' },
      });
    expect(first.status).toBe(201);
    const reused = await request(app)
      .post(pPath(office.id))
      .set(bearer(owner.accessToken))
      .send({
        name: 'B',
        productType: 'MEDICINE',
        image: { storageKey: key, mimeType: 'image/jpeg' },
      });
    expect(reused.status).toBe(409);
    expect(
      await getTestDb()('veterinary_office_products').where({ organization_id: office.id }),
    ).toHaveLength(1);
  });

  it('only members with product.create may presign a new-product image', async () => {
    const { office } = await setupOffice();
    const stranger = await registerUser(app);
    const res = await request(app)
      .post(`${pPath(office.id)}/images/upload-url`)
      .set(bearer(stranger.accessToken))
      .send({ filename: 'p.jpg', mimeType: 'image/jpeg', size: 1024 });
    expect(res.status).toBe(403);
  });
});

describe('product image replacement', () => {
  async function productWithImage() {
    const ctx = await setupOffice();
    const prod = await createVeterinaryOfficeProduct(app, ctx.owner.accessToken, ctx.office.id);
    const oldKey = await upload(
      ctx.owner.accessToken,
      `${pPath(ctx.office.id, prod.id)}/images/upload-url`,
    );
    const added = await request(app)
      .post(`${pPath(ctx.office.id, prod.id)}/images`)
      .set(bearer(ctx.owner.accessToken))
      .send({ storageKey: oldKey, mimeType: 'image/jpeg' })
      .expect(200);
    const imageId = added.body.data.images[0].id as string;
    return {
      ...ctx,
      prod,
      oldKey,
      imageId,
      imagePath: `${pPath(ctx.office.id, prod.id)}/images/${imageId}`,
    };
  }

  it('swaps the image in place, moves the cover and deletes the old object after commit', async () => {
    const { owner, prod, oldKey, imageId, imagePath } = await productWithImage();
    const newKey = await upload(owner.accessToken, `${imagePath}/upload-url`);

    const res = await request(app)
      .put(imagePath)
      .set(bearer(owner.accessToken))
      .send({ storageKey: newKey, mimeType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(res.body.data.images).toEqual([
      expect.objectContaining({ id: imageId, isPrimary: true }),
    ]);

    const row = await getTestDb()('veterinary_office_products').where({ id: prod.id }).first();
    expect(row.primary_image_key).toBe(newKey);
    expect(await storage.exists(newKey)).toBe(true);
    expect(await storage.exists(oldKey)).toBe(false);
    const audit = await getTestDb()('audit_logs')
      .where({ action: 'VETERINARY_OFFICE_PRODUCT_IMAGE_UPDATED', entity_id: prod.id })
      .orderBy('created_at', 'desc')
      .first();
    expect(audit.metadata).toMatchObject({ op: 'replaced', imageId });
  });

  it('a failed / missing upload leaves the existing image and its object untouched', async () => {
    const { owner, prod, oldKey, imagePath } = await productWithImage();
    const neverUploaded = await upload(owner.accessToken, `${imagePath}/upload-url`, false);

    const res = await request(app)
      .put(imagePath)
      .set(bearer(owner.accessToken))
      .send({ storageKey: neverUploaded, mimeType: 'image/jpeg' });
    expect(res.status).toBe(400);
    const row = await getTestDb()('veterinary_office_products').where({ id: prod.id }).first();
    expect(row.primary_image_key).toBe(oldKey);
    expect(await storage.exists(oldKey)).toBe(true);
  });

  it('a storage delete failure does not fail the replace (row is already correct)', async () => {
    const { owner, prod, oldKey, imagePath } = await productWithImage();
    const newKey = await upload(owner.accessToken, `${imagePath}/upload-url`);
    const realDelete = storage.delete.bind(storage);
    storage.delete = async () => {
      throw new Error('R2 down');
    };
    try {
      await request(app)
        .put(imagePath)
        .set(bearer(owner.accessToken))
        .send({ storageKey: newKey, mimeType: 'image/jpeg' })
        .expect(200);
    } finally {
      storage.delete = realDelete;
    }
    const row = await getTestDb()('veterinary_office_products').where({ id: prod.id }).first();
    expect(row.primary_image_key).toBe(newKey);
    expect(await storage.exists(oldKey)).toBe(true); // left for the sweep, never lost data
  });

  it('cannot hijack another product’s object, and is scoped to the office', async () => {
    const a = await productWithImage();
    const otherProd = await createVeterinaryOfficeProduct(app, a.owner.accessToken, a.office.id);
    const otherKey = await upload(
      a.owner.accessToken,
      `${pPath(a.office.id, otherProd.id)}/images/upload-url`,
    );
    await request(app)
      .post(`${pPath(a.office.id, otherProd.id)}/images`)
      .set(bearer(a.owner.accessToken))
      .send({ storageKey: otherKey, mimeType: 'image/jpeg' })
      .expect(200);

    // Re-using a key already attached elsewhere → 409; nothing changes or is deleted.
    await request(app)
      .put(a.imagePath)
      .set(bearer(a.owner.accessToken))
      .send({ storageKey: otherKey, mimeType: 'image/jpeg' })
      .expect(409);
    expect(await storage.exists(a.oldKey)).toBe(true);
    expect(await storage.exists(otherKey)).toBe(true);

    // Image id of another product under this product's URL → 404.
    const otherImage = await getTestDb()('veterinary_office_product_images')
      .where({ product_id: otherProd.id })
      .first();
    await request(app)
      .put(`${pPath(a.office.id, a.prod.id)}/images/${otherImage.id}`)
      .set(bearer(a.owner.accessToken))
      .send({ storageKey: otherKey, mimeType: 'image/jpeg' })
      .expect(404);

    // Non-member → 403.
    const stranger = await registerUser(app);
    await request(app)
      .put(a.imagePath)
      .set(bearer(stranger.accessToken))
      .send({ storageKey: otherKey, mimeType: 'image/jpeg' })
      .expect(403);
  });
});
