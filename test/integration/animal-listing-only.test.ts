import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  approvePublication,
  bearer,
  createAnimal,
  createAnimalPublication,
  registerAdmin,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('adoption / mating / lost listings are not registered pets', () => {
  it('a listing-only animal never appears in the owner’s pets, while the listing still works', async () => {
    const owner = await registerUser(app);
    const admin = await registerAdmin(app);
    const pet = await createAnimal(app, owner.accessToken, { name: 'Real Pet' });

    const listingAnimal = await request(app)
      .post('/api/v1/animals')
      .set(bearer(owner.accessToken))
      .send({
        name: 'قط للتبني',
        species: 'CAT',
        color: 'رمادي',
        ageEstimate: 'ONE_TO_3_YEARS',
        listingOnly: true,
      });
    expect(listingAnimal.status).toBe(201);
    expect(listingAnimal.body.data.listingOnly).toBe(true);
    // Previously-dropped profile fields are persisted now.
    expect(listingAnimal.body.data.color).toBe('رمادي');

    const pub = await createAnimalPublication(app, owner.accessToken, listingAnimal.body.data.id, {
      kind: 'ADOPTION',
    });
    expect((await approvePublication(app, admin.accessToken, pub.id)).status).toBe(200);

    const mine = await request(app).get('/api/v1/animals').set(bearer(owner.accessToken));
    expect(mine.status).toBe(200);
    const ids = (mine.body.data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual([pet.id]);

    const publicList = await request(app)
      .get('/api/v1/animal-publications?kind=ADOPTION')
      .set(bearer(admin.accessToken));
    expect(publicList.body.data.map((p: { id: string }) => p.id)).toContain(pub.id);

    // The owner still owns (and may manage) the listing's animal.
    const detail = await request(app)
      .get(`/api/v1/animals/${listingAnimal.body.data.id}`)
      .set(bearer(owner.accessToken));
    expect(detail.status).toBe(200);
  });

  it('publishing an existing registered pet keeps it in the owner’s pets', async () => {
    const owner = await registerUser(app);
    const pet = await createAnimal(app, owner.accessToken, { name: 'Buddy' });
    await createAnimalPublication(app, owner.accessToken, pet.id, { kind: 'MATING' });
    const mine = await request(app).get('/api/v1/animals').set(bearer(owner.accessToken));
    expect((mine.body.data as Array<{ id: string }>).map((a) => a.id)).toEqual([pet.id]);
  });
});
