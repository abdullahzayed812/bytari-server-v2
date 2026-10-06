import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  addToPetStoreCart,
  addToVetStoreCart,
  bearer,
  checkoutPetStoreCart,
  checkoutVetStoreCart,
  createPetStoreProduct,
  createVetStoreProduct,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

/** Both stores share the exact same category-section + new-orders contract. */
const STORES = [
  {
    label: 'Pet Owners Store',
    base: 'pet-owner-store',
    shopper: (a: typeof app) => registerUser(a),
    product: createPetStoreProduct,
    addToCart: addToPetStoreCart,
    checkout: checkoutPetStoreCart,
  },
  {
    label: 'Veterinarian Store',
    base: 'veterinarian-store',
    shopper: (a: typeof app) => registerApprovedVet(a),
    product: createVetStoreProduct,
    addToCart: addToVetStoreCart,
    checkout: checkoutVetStoreCart,
  },
] as const;

for (const store of STORES) {
  const api = (p: string): string => `/api/v1/${store.base}${p}`;
  const adminApi = (p: string): string => `/api/v1/admin/${store.base}${p}`;

  describe(`${store.label} — category sections`, () => {
    it('a section groups sub-categories; filtering by the section returns all of their products', async () => {
      const admin = await registerAdmin(app);
      const shopper = await store.shopper(app);
      const cat = (body: Record<string, unknown>) =>
        request(app).post(adminApi('/categories')).set(bearer(admin.accessToken)).send(body);

      const section = await cat({ slug: 'pets', name: 'الحيوانات الأليفة' });
      expect(section.status).toBe(201);
      expect(section.body.data.parentId).toBeNull();
      const meds = await cat({ slug: 'pets-meds', name: 'أدوية', parentId: section.body.data.id });
      const supp = await cat({
        slug: 'pets-supplements',
        name: 'مكملات غذائية',
        parentId: section.body.data.id,
      });
      const other = await cat({ slug: 'livestock', name: 'المواشي' });
      expect(meds.body.data.parentId).toBe(section.body.data.id);

      // two levels only + no self-parenting + unknown parent
      const nested = await cat({ slug: 'deep', name: 'عميق', parentId: meds.body.data.id });
      expect(nested.status).toBe(400);
      const self = await request(app)
        .patch(adminApi(`/categories/${section.body.data.id}`))
        .set(bearer(admin.accessToken))
        .send({ parentId: section.body.data.id });
      expect(self.status).toBe(400);
      const moveSection = await request(app)
        .patch(adminApi(`/categories/${section.body.data.id}`))
        .set(bearer(admin.accessToken))
        .send({ parentId: other.body.data.id });
      expect(moveSection.status).toBe(400);

      const p1 = await store.product(app, admin.accessToken, {
        name: 'مضاد حيوي',
        categoryId: meds.body.data.id,
      });
      const p2 = await store.product(app, admin.accessToken, {
        name: 'فيتامينات',
        categoryId: supp.body.data.id,
      });
      await store.product(app, admin.accessToken, {
        name: 'علف أبقار',
        categoryId: other.body.data.id,
      });

      const bySection = await request(app)
        .get(api(`/products?categoryId=${section.body.data.id}`))
        .set(bearer(shopper.accessToken));
      expect(bySection.status).toBe(200);
      expect((bySection.body.data as { id: string }[]).map((p) => p.id).sort()).toEqual(
        [p1.id, p2.id].sort(),
      );
      const bySub = await request(app)
        .get(api(`/products?categoryId=${meds.body.data.id}`))
        .set(bearer(shopper.accessToken));
      expect((bySub.body.data as { id: string }[]).map((p) => p.id)).toEqual([p1.id]);

      // the storefront category list carries the hierarchy
      const cats = await request(app).get(api('/categories')).set(bearer(shopper.accessToken));
      const byId = new Map(
        (cats.body.data as { id: string; parentId: string | null }[]).map((c) => [c.id, c]),
      );
      expect(byId.get(supp.body.data.id)?.parentId).toBe(section.body.data.id);

      // a section with sub-categories cannot be deleted
      const del = await request(app)
        .delete(adminApi(`/categories/${section.body.data.id}`))
        .set(bearer(admin.accessToken));
      expect(del.status).toBe(409);
    });

    it('search matches product name, attributes, the category and its parent section name', async () => {
      const admin = await registerAdmin(app);
      const shopper = await store.shopper(app);
      const cat = (body: Record<string, unknown>) =>
        request(app).post(adminApi('/categories')).set(bearer(admin.accessToken)).send(body);
      const section = await cat({ slug: 'cats-section', name: 'قطط' });
      const food = await cat({ slug: 'cats-food', name: 'أغذية', parentId: section.body.data.id });
      const p1 = await store.product(app, admin.accessToken, {
        name: 'علبة دجاج',
        categoryId: food.body.data.id,
        attributes: { الماركة: 'Royal Canin' },
      });
      await store.product(app, admin.accessToken, { name: 'منتج آخر' });

      const ids = async (q: string): Promise<string[]> => {
        const res = await request(app)
          .get(api(`/products?search=${encodeURIComponent(q)}`))
          .set(bearer(shopper.accessToken));
        expect(res.status).toBe(200);
        return (res.body.data as { id: string }[]).map((p) => p.id);
      };
      expect(await ids('قطط')).toEqual([p1.id]); // parent section
      expect(await ids('أغذية')).toEqual([p1.id]); // category
      expect(await ids('royal')).toEqual([p1.id]); // attribute (brand)
      expect(await ids('%')).toEqual([]); // LIKE wildcards are literal
    });
  });

  describe(`${store.label} — new orders badge`, () => {
    it('a placed order is "new" until a manager opens it or changes its status', async () => {
      const admin = await registerAdmin(app);
      const shopper = await store.shopper(app);
      const product = await store.product(app, admin.accessToken, {
        name: 'منتج',
        stockQuantity: 10,
      });
      const summary = () =>
        request(app).get(adminApi('/orders/summary')).set(bearer(admin.accessToken));
      expect((await summary()).body.data).toEqual({ newCount: 0 });

      await store.addToCart(app, shopper.accessToken, product.id, 1);
      const o1 = await store.checkout(app, shopper.accessToken);
      expect(o1.status).toBe(201);
      await store.addToCart(app, shopper.accessToken, product.id, 1);
      const o2 = await store.checkout(app, shopper.accessToken);
      expect((await summary()).body.data).toEqual({ newCount: 2 });

      const list = await request(app)
        .get(adminApi('/orders?newOnly=true'))
        .set(bearer(admin.accessToken));
      expect(list.body.data).toHaveLength(2);
      expect(list.body.data.every((o: { isNew: boolean }) => o.isNew)).toBe(true);

      // a plain shopper cannot read the badge
      const denied = await request(app)
        .get(adminApi('/orders/summary'))
        .set(bearer(shopper.accessToken));
      expect(denied.status).toBe(403);

      await request(app)
        .get(adminApi(`/orders/${o1.body.data.id}`))
        .set(bearer(admin.accessToken));
      expect((await summary()).body.data).toEqual({ newCount: 1 });

      await request(app)
        .patch(adminApi(`/orders/${o2.body.data.id}/status`))
        .set(bearer(admin.accessToken))
        .send({ status: 'CONFIRMED' });
      expect((await summary()).body.data).toEqual({ newCount: 0 });
    });
  });
}
