import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addToVetStoreCart,
  assignSystemSupervisor,
  bearer,
  checkoutVetStoreCart,
  createVetStoreCategory,
  createVetStoreProduct,
  registerAdmin,
  registerUser,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const api = (p: string): string => `/api/v1/veterinarian-store${p}`;
const adminApi = (p: string): string => `/api/v1/admin/veterinarian-store${p}`;

describe('Veterinarian Store — admin catalogue management', () => {
  it('an admin creates a category + product; a plain user cannot', async () => {
    const admin = await registerAdmin(app);
    const shopper = await registerUser(app);

    const denied = await request(app)
      .post(adminApi('/products'))
      .set(bearer(shopper.accessToken))
      .send({ name: 'x', price: '5.00' });
    expect(denied.status).toBe(403);

    const cat = await createVetStoreCategory(app, admin.accessToken, {
      slug: 'medicines',
      name: 'أدوية',
      showOnHome: true,
    });
    const create = await request(app)
      .post(adminApi('/products'))
      .set(bearer(admin.accessToken))
      .send({
        categoryId: cat.id,
        name: 'أموكسيسيلين 15%',
        description: 'مضاد حيوي واسع الطيف',
        price: '15000.00',
        stockQuantity: 40,
        attributes: { التصنيف: 'مضاد حيوي' },
      });
    expect(create.status).toBe(201);
    expect(create.body.data).toMatchObject({
      name: 'أموكسيسيلين 15%',
      price: '15000.00',
      stockQuantity: 40,
      status: 'ACTIVE',
      categoryId: cat.id,
      categoryName: 'أدوية',
    });
    expect(typeof create.body.data.price).toBe('string');
  });

  it('an ACTIVE VETERINARIAN_STORE supervisor can manage products', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, sup.id, 'VETERINARIAN_STORE');

    const created = await createVetStoreProduct(app, sup.accessToken, { name: 'إيفرمكتين 1%' });
    expect(created.id).toBeTruthy();

    const upd = await request(app)
      .patch(adminApi(`/products/${created.id}`))
      .set(bearer(sup.accessToken))
      .send({ price: '13000.00', status: 'INACTIVE' });
    expect(upd.status).toBe(200);
    expect(upd.body.data).toMatchObject({ price: '13000.00', status: 'INACTIVE' });
  });

  it('rejects invalid product bodies (422) and an empty patch (422)', async () => {
    const admin = await registerAdmin(app);
    for (const bad of [
      { name: '', price: '5.00' },
      { name: 'x', price: '-5' },
      { name: 'x', price: '12.999' },
      { name: 'x' },
    ]) {
      const res = await request(app)
        .post(adminApi('/products'))
        .set(bearer(admin.accessToken))
        .send(bad);
      expect(res.status).toBe(422);
    }
    const prod = await createVetStoreProduct(app, admin.accessToken);
    const emptyPatch = await request(app)
      .patch(adminApi(`/products/${prod.id}`))
      .set(bearer(admin.accessToken))
      .send({});
    expect(emptyPatch.status).toBe(422);
  });

  it('presigned product image upload → register → primary image resolves', async () => {
    const admin = await registerAdmin(app);
    const prod = await createVetStoreProduct(app, admin.accessToken);

    const urlRes = await request(app)
      .post(adminApi(`/products/${prod.id}/image/upload-url`))
      .set(bearer(admin.accessToken))
      .send({ filename: 'medicine.png', mimeType: 'image/png', size: 4096 });
    expect(urlRes.status).toBe(200);
    const storageKey = urlRes.body.data.storageKey as string;
    expect(storageKey.startsWith('veterinarian-store/products/')).toBe(true);

    await container.objectStorage.put(storageKey, Buffer.alloc(4096, 1), {
      contentType: 'image/png',
    });

    const register = await request(app)
      .post(adminApi(`/products/${prod.id}/images`))
      .set(bearer(admin.accessToken))
      .send({ storageKey, mimeType: 'image/png' });
    expect(register.status).toBe(201);
    expect(register.body.data.primaryImageUrl).toBeTruthy();
    expect(register.body.data.images).toHaveLength(1);
  });

  it('deleting a category nulls its products’ category, products remain', async () => {
    const admin = await registerAdmin(app);
    const cat = await createVetStoreCategory(app, admin.accessToken, { slug: 'equipment' });
    const prod = await createVetStoreProduct(app, admin.accessToken, { categoryId: cat.id });

    const del = await request(app)
      .delete(adminApi(`/categories/${cat.id}`))
      .set(bearer(admin.accessToken));
    expect(del.status).toBe(204);

    const read = await request(app)
      .get(adminApi(`/products/${prod.id}`))
      .set(bearer(admin.accessToken));
    expect(read.status).toBe(200);
    expect(read.body.data.categoryId).toBeNull();
  });
});

describe('Veterinarian Store — consumer catalogue', () => {
  it('lists only ACTIVE products, supports search + category filter', async () => {
    const admin = await registerAdmin(app);
    const shopper = await registerUser(app);
    const catMed = await createVetStoreCategory(app, admin.accessToken, { slug: 'medicines' });
    const catEquip = await createVetStoreCategory(app, admin.accessToken, { slug: 'equipment' });

    await createVetStoreProduct(app, admin.accessToken, {
      name: 'أموكسيسيلين 15%',
      categoryId: catMed.id,
    });
    await createVetStoreProduct(app, admin.accessToken, {
      name: 'سماعة طبية بيطرية',
      categoryId: catEquip.id,
    });
    const hidden = await createVetStoreProduct(app, admin.accessToken, {
      name: 'منتج غير نشط',
      status: 'INACTIVE',
    });

    const all = await request(app).get(api('/products')).set(bearer(shopper.accessToken));
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.data.map((p: { id: string }) => p.id)).not.toContain(hidden.id);

    const byCat = await request(app)
      .get(api(`/products?categoryId=${catEquip.id}`))
      .set(bearer(shopper.accessToken));
    expect(byCat.body.data).toHaveLength(1);
    expect(byCat.body.data[0].name).toBe('سماعة طبية بيطرية');

    const search = await request(app)
      .get(api('/products?search=أموكسيسيلين'))
      .set(bearer(shopper.accessToken));
    expect(search.body.data).toHaveLength(1);

    const home = await request(app).get(api('/categories?homeOnly=true'));
    expect(home.status).toBe(401); // still needs auth
    const cats = await request(app).get(api('/categories')).set(bearer(shopper.accessToken));
    expect(cats.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('product detail 404s for an INACTIVE product', async () => {
    const admin = await registerAdmin(app);
    const shopper = await registerUser(app);
    const prod = await createVetStoreProduct(app, admin.accessToken, { status: 'INACTIVE' });
    const res = await request(app)
      .get(api(`/products/${prod.id}`))
      .set(bearer(shopper.accessToken));
    expect(res.status).toBe(404);
  });
});

describe('Veterinarian Store — cart', () => {
  it('adds, merges quantity, updates, removes and clears', async () => {
    const admin = await registerAdmin(app);
    const shopper = await registerUser(app);
    const prod = await createVetStoreProduct(app, admin.accessToken, {
      price: '85.00',
      stockQuantity: 10,
    });

    const add1 = await addToVetStoreCart(app, shopper.accessToken, prod.id, 2);
    expect(add1.status).toBe(201);
    expect(add1.body.data.itemCount).toBe(2);
    expect(add1.body.data.subtotalAmount).toBe('170.00');
    expect(add1.body.data.totalAmount).toBe('170.00');
    expect(add1.body.data.deliveryFee).toBe('0.00');

    const add2 = await addToVetStoreCart(app, shopper.accessToken, prod.id, 1);
    expect(add2.body.data.items).toHaveLength(1);
    expect(add2.body.data.items[0].quantity).toBe(3);
    const itemId = add2.body.data.items[0].id as string;

    const upd = await request(app)
      .patch(api(`/cart/items/${itemId}`))
      .set(bearer(shopper.accessToken))
      .send({ quantity: 5 });
    expect(upd.body.data.items[0].quantity).toBe(5);
    expect(upd.body.data.subtotalAmount).toBe('425.00');

    const rm = await request(app)
      .delete(api(`/cart/items/${itemId}`))
      .set(bearer(shopper.accessToken));
    expect(rm.body.data.items).toHaveLength(0);
    expect(rm.body.data.itemCount).toBe(0);
  });

  it('rejects adding more than available stock (409)', async () => {
    const admin = await registerAdmin(app);
    const shopper = await registerUser(app);
    const prod = await createVetStoreProduct(app, admin.accessToken, { stockQuantity: 3 });

    const res = await addToVetStoreCart(app, shopper.accessToken, prod.id, 5);
    expect(res.status).toBe(409);
  });

  it("one shopper cannot touch another shopper's cart item (404)", async () => {
    const admin = await registerAdmin(app);
    const a = await registerUser(app);
    const b = await registerUser(app);
    const prod = await createVetStoreProduct(app, admin.accessToken);

    const add = await addToVetStoreCart(app, a.accessToken, prod.id, 1);
    const itemId = add.body.data.items[0].id as string;

    const res = await request(app)
      .patch(api(`/cart/items/${itemId}`))
      .set(bearer(b.accessToken))
      .send({ quantity: 2 });
    expect(res.status).toBe(404);
  });
});

describe('Veterinarian Store — checkout & orders', () => {
  it('checkout (COD) creates an order, decrements stock and empties the cart', async () => {
    const admin = await registerAdmin(app);
    const shopper = await registerUser(app);
    const p1 = await createVetStoreProduct(app, admin.accessToken, {
      name: 'أموكسيسيلين 15%',
      price: '85.00',
      stockQuantity: 10,
    });
    const p2 = await createVetStoreProduct(app, admin.accessToken, {
      name: 'إيفرمكتين 1%',
      price: '28.00',
      stockQuantity: 10,
    });
    await addToVetStoreCart(app, shopper.accessToken, p1.id, 1);
    await addToVetStoreCart(app, shopper.accessToken, p2.id, 2);

    const order = await checkoutVetStoreCart(app, shopper.accessToken);
    expect(order.status).toBe(201);
    expect(order.body.data).toMatchObject({
      status: 'PENDING',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      subtotalAmount: '141.00',
      totalAmount: '141.00',
      currency: 'SAR',
      recipientName: 'د. أحمد محمد',
      city: 'الرياض',
    });
    expect(order.body.data.orderNumber).toMatch(/^VTS-\d{8}-\d{6}$/);
    expect(order.body.data.items).toHaveLength(2);

    const cart = await request(app).get(api('/cart')).set(bearer(shopper.accessToken));
    expect(cart.body.data.items).toHaveLength(0);

    const p1Read = await request(app)
      .get(adminApi(`/products/${p1.id}`))
      .set(bearer(admin.accessToken));
    expect(p1Read.body.data.stockQuantity).toBe(9);
    const p2Read = await request(app)
      .get(adminApi(`/products/${p2.id}`))
      .set(bearer(admin.accessToken));
    expect(p2Read.body.data.stockQuantity).toBe(8);
  });

  it('rejects a non-COD payment method (400) and an empty cart (400)', async () => {
    const admin = await registerAdmin(app);
    const shopper = await registerUser(app);

    const empty = await checkoutVetStoreCart(app, shopper.accessToken);
    expect(empty.status).toBe(400);

    const prod = await createVetStoreProduct(app, admin.accessToken);
    await addToVetStoreCart(app, shopper.accessToken, prod.id, 1);
    const card = await checkoutVetStoreCart(app, shopper.accessToken, { paymentMethod: 'MADA' });
    expect(card.status).toBe(400);
  });

  it('order history is private; another shopper gets 404 on the detail', async () => {
    const admin = await registerAdmin(app);
    const a = await registerUser(app);
    const b = await registerUser(app);
    const prod = await createVetStoreProduct(app, admin.accessToken);
    await addToVetStoreCart(app, a.accessToken, prod.id, 1);
    const order = await checkoutVetStoreCart(app, a.accessToken);
    const orderId = order.body.data.id as string;

    const aList = await request(app).get(api('/orders')).set(bearer(a.accessToken));
    expect(aList.body.data).toHaveLength(1);
    const bList = await request(app).get(api('/orders')).set(bearer(b.accessToken));
    expect(bList.body.data).toHaveLength(0);

    const bGet = await request(app)
      .get(api(`/orders/${orderId}`))
      .set(bearer(b.accessToken));
    expect(bGet.status).toBe(404);
  });

  it('admin lists all orders and advances status; invalid transitions are refused', async () => {
    const admin = await registerAdmin(app);
    const shopper = await registerUser(app);
    const prod = await createVetStoreProduct(app, admin.accessToken);
    await addToVetStoreCart(app, shopper.accessToken, prod.id, 1);
    const order = await checkoutVetStoreCart(app, shopper.accessToken);
    const orderId = order.body.data.id as string;

    const list = await request(app).get(adminApi('/orders')).set(bearer(admin.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const bad = await request(app)
      .patch(adminApi(`/orders/${orderId}/status`))
      .set(bearer(admin.accessToken))
      .send({ status: 'DELIVERED' });
    expect(bad.status).toBe(409);

    const ok = await request(app)
      .patch(adminApi(`/orders/${orderId}/status`))
      .set(bearer(admin.accessToken))
      .send({ status: 'CONFIRMED' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('CONFIRMED');

    const shopperDenied = await request(app)
      .get(adminApi('/orders'))
      .set(bearer(shopper.accessToken));
    expect(shopperDenied.status).toBe(403);
  });
});
