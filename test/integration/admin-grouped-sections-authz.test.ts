import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createAnimal,
  createAnimalPublication,
  createContent,
  registerAdmin,
  registerAnimalSupervisor,
  registerContentSupervisor,
  registerUser,
} from '../helpers/factories.js';

/**
 * The admin dashboard groups Adoption / Mating / Lost into one tabbed section
 * and Books / Magazines into another. That grouping is UI-only: every tab
 * still calls its own API, and each API keeps enforcing its own domain. A
 * supervisor of one grouped section must not reach the other's API.
 */
const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function seed() {
  const admin = await registerAdmin(app);
  const owner = await registerUser(app);
  const pubs = [];
  for (const kind of ['ADOPTION', 'MATING', 'LOST'] as const) {
    const animal = await createAnimal(app, owner.accessToken);
    pubs.push(await createAnimalPublication(app, owner.accessToken, animal.id, { kind }));
  }
  const book = await createContent(app, admin.accessToken, { type: 'BOOK', title: 'Book' });
  const magazine = await createContent(app, admin.accessToken, {
    type: 'MAGAZINE',
    title: 'Magazine',
  });
  return {
    admin,
    owner,
    pubs,
    bookId: book.body.data.id as string,
    magazineId: magazine.body.data.id as string,
  };
}

describe('grouped admin sections keep per-domain backend authorization', () => {
  it('a CONTENT supervisor cannot list or moderate any adoption / mating / lost tab', async () => {
    const { admin, pubs } = await seed();
    const sup = await registerContentSupervisor(app, admin.accessToken);

    for (const kind of ['ADOPTION', 'MATING', 'LOST']) {
      const res = await request(app)
        .get(`/api/v1/admin/animal-publications?kind=${kind}`)
        .set(bearer(sup.accessToken));
      expect(res.status).toBe(403);
    }
    for (const pub of pubs) {
      const res = await request(app)
        .post(`/api/v1/admin/animal-publications/${pub.id}/approve`)
        .set(bearer(sup.accessToken));
      expect(res.status).toBe(403);
    }
  });

  it('an ANIMAL supervisor can use every adoption / mating / lost tab but neither books nor magazines', async () => {
    const { admin, pubs, bookId, magazineId } = await seed();
    const sup = await registerAnimalSupervisor(app, admin.accessToken);

    for (const pub of pubs) {
      const list = await request(app)
        .get(`/api/v1/admin/animal-publications?kind=${pub.kind}`)
        .set(bearer(sup.accessToken));
      expect(list.status).toBe(200);
      expect(list.body.data.map((p: { id: string }) => p.id)).toContain(pub.id);
    }

    for (const type of ['BOOK', 'MAGAZINE']) {
      const res = await request(app)
        .get(`/api/v1/admin/content?type=${type}`)
        .set(bearer(sup.accessToken));
      expect(res.status).toBe(403);
    }
    expect((await createContent(app, sup.accessToken, { type: 'BOOK', title: 'x' })).status).toBe(
      403,
    );
    for (const id of [bookId, magazineId]) {
      const res = await request(app)
        .delete(`/api/v1/admin/content/${id}`)
        .set(bearer(sup.accessToken));
      expect(res.status).toBe(403);
    }
  });

  it('a plain user is refused on every underlying API of both grouped sections', async () => {
    const { owner } = await seed();
    const calls = [
      '/api/v1/admin/animal-publications?kind=ADOPTION',
      '/api/v1/admin/animal-publications?kind=MATING',
      '/api/v1/admin/animal-publications?kind=LOST',
      '/api/v1/admin/content?type=BOOK',
      '/api/v1/admin/content?type=MAGAZINE',
    ];
    for (const url of calls) {
      const res = await request(app).get(url).set(bearer(owner.accessToken));
      expect(res.status).toBe(403);
    }
  });
});
