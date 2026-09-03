import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  approvePublication,
  bearer,
  createAnimal,
  createAnimalPublication,
  registerAdmin,
  registerAnimalSupervisor,
  registerUser,
  assignSystemSupervisor,
  transferAnimal,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const pubPath = (animalId: string, id?: string): string =>
  `/api/v1/animals/${animalId}/publications${id ? `/${id}` : ''}`;
const adminPath = (id?: string, suffix = ''): string =>
  `/api/v1/admin/animal-publications${id ? `/${id}` : ''}${suffix}`;

/** A fully valid LOST create body — each kind requires a different field set. */
function lostBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'LOST',
    contactName: 'Test Contact',
    contactPhone: '07701234567',
    lostDate: '2026-01-01',
    lostGovernorate: 'Baghdad',
    lostDistrict: 'Karrada',
    ...overrides,
  };
}

/** A fully valid ADOPTION create body. */
function adoptionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'ADOPTION',
    note: 'Friendly and playful, looking for a loving home.',
    contactName: 'Test Contact',
    contactPhone: '07701234567',
    city: 'Baghdad',
    healthStatus: 'GOOD',
    vaccinationStatus: 'COMPLETE',
    isSterilized: false,
    ...overrides,
  };
}

describe('animal publications — owner create', () => {
  it('the owner publishes an animal as LOST; it starts PENDING and is not public', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);

    const res = await request(app)
      .post(pubPath(animal.id))
      .set(bearer(owner.accessToken))
      .send(lostBody({ note: 'last seen near the park' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      animalId: animal.id,
      kind: 'LOST',
      status: 'PENDING',
      createdByUserId: owner.id,
      reviewedByUserId: null,
      reviewedAt: null,
    });

    // not visible in the public browse
    const browse = await request(app)
      .get('/api/v1/animal-publications?kind=LOST')
      .set(bearer(owner.accessToken));
    expect(browse.status).toBe(200);
    expect(browse.body.data).toHaveLength(0);
  });

  it('supports ADOPTION and MATING with the same lifecycle', async () => {
    const owner = await registerUser(app);
    const a1 = await createAnimal(app, owner.accessToken);
    const a2 = await createAnimal(app, owner.accessToken);
    const p1 = await createAnimalPublication(app, owner.accessToken, a1.id, { kind: 'ADOPTION' });
    const p2 = await createAnimalPublication(app, owner.accessToken, a2.id, { kind: 'MATING' });
    expect(p1.status).toBe('PENDING');
    expect(p2.status).toBe('PENDING');
  });

  it('rejects a non-owner publishing someone else’s animal (404)', async () => {
    const owner = await registerUser(app);
    const attacker = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);

    const res = await request(app)
      .post(pubPath(animal.id))
      .set(bearer(attacker.accessToken))
      .send(lostBody());
    expect(res.status).toBe(404);
    expect(await getTestDb()('animal_publications')).toHaveLength(0);
  });

  it('does not let an ADMIN publish on an owner’s behalf (owner-only, 404)', async () => {
    const owner = await registerUser(app);
    const admin = await registerAdmin(app);
    const animal = await createAnimal(app, owner.accessToken);
    const res = await request(app)
      .post(pubPath(animal.id))
      .set(bearer(admin.accessToken))
      .send(lostBody());
    expect(res.status).toBe(404);
  });

  it('rejects an invalid kind and a deactivated animal', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);

    const badKind = await request(app)
      .post(pubPath(animal.id))
      .set(bearer(owner.accessToken))
      .send({ kind: 'SALE' });
    expect(badKind.status).toBe(422);

    await request(app).delete(`/api/v1/animals/${animal.id}`).set(bearer(owner.accessToken));
    const deactivated = await request(app)
      .post(pubPath(animal.id))
      .set(bearer(owner.accessToken))
      .send(lostBody());
    expect(deactivated.status).toBe(409);
    expect(deactivated.body.error.code).toBe('ANIMAL_NOT_ACTIVE');
  });

  it('rejects a second open publication of the same kind for one animal (409)', async () => {
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    await createAnimalPublication(app, owner.accessToken, animal.id, { kind: 'LOST' });

    const dup = await request(app)
      .post(pubPath(animal.id))
      .set(bearer(owner.accessToken))
      .send(lostBody());
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('PUBLICATION_ALREADY_OPEN');

    // a different kind is fine
    const adopt = await request(app)
      .post(pubPath(animal.id))
      .set(bearer(owner.accessToken))
      .send(adoptionBody());
    expect(adopt.status).toBe(201);
  });

  it('rejects client-supplied status / reviewer / owner fields (unknown keys, strict schema)', async () => {
    const owner = await registerUser(app);
    const other = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);

    const forged = await request(app)
      .post(pubPath(animal.id))
      .set(bearer(owner.accessToken))
      .send({
        ...lostBody(),
        status: 'APPROVED',
        reviewedByUserId: owner.id,
        reviewedAt: '2020-01-01T00:00:00Z',
        createdByUserId: other.id,
        rejectionReason: 'x',
      });
    expect(forged.status).toBe(422);
    expect(await getTestDb()('animal_publications')).toHaveLength(0);

    // the same request without the forged keys succeeds with server-controlled defaults
    const res = await request(app)
      .post(pubPath(animal.id))
      .set(bearer(owner.accessToken))
      .send(lostBody());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'PENDING',
      createdByUserId: owner.id,
      reviewedByUserId: null,
      reviewedAt: null,
      rejectionReason: null,
    });
  });
});

describe('animal publications — moderation', () => {
  async function pending(kind: 'LOST' | 'ADOPTION' | 'MATING' = 'LOST') {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, { kind });
    return { admin, owner, animal, pub };
  }

  it('an ADMIN approves a pending publication → it becomes publicly visible', async () => {
    const { admin, owner, pub } = await pending();

    const res = await request(app)
      .post(adminPath(pub.id, '/approve'))
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'APPROVED', reviewedByUserId: admin.id });
    expect(res.body.data.reviewedAt).not.toBeNull();

    const browse = await request(app)
      .get('/api/v1/animal-publications?kind=LOST')
      .set(bearer(owner.accessToken));
    expect(browse.body.data).toHaveLength(1);
    expect(browse.body.data[0]).toMatchObject({ id: pub.id, kind: 'LOST' });
    // public projection carries no owner PII / moderation metadata
    expect(browse.body.data[0]).not.toHaveProperty('createdByUserId');
    expect(browse.body.data[0]).not.toHaveProperty('reviewedByUserId');
    expect(browse.body.data[0]).not.toHaveProperty('status');
  });

  it('an ADMIN rejects a pending publication with a reason; it stays non-public', async () => {
    const { admin, owner, pub } = await pending('ADOPTION');

    const res = await request(app)
      .post(adminPath(pub.id, '/reject'))
      .set(bearer(admin.accessToken))
      .send({ reason: 'insufficient detail' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'insufficient detail',
      reviewedByUserId: admin.id,
    });

    const browse = await request(app)
      .get('/api/v1/animal-publications?kind=ADOPTION')
      .set(bearer(owner.accessToken));
    expect(browse.body.data).toHaveLength(0);
  });

  it('an ANIMAL system supervisor can approve; a wrong-domain supervisor cannot', async () => {
    const { admin, pub } = await pending('MATING');
    const animalSup = await registerAnimalSupervisor(app, admin.accessToken);

    const clinicSupUser = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, clinicSupUser.id, 'CLINIC');

    // wrong domain → 403
    const wrong = await request(app)
      .post(adminPath(pub.id, '/approve'))
      .set(bearer(clinicSupUser.accessToken));
    expect(wrong.status).toBe(403);

    // right domain → 200
    const ok = await request(app)
      .post(adminPath(pub.id, '/approve'))
      .set(bearer(animalSup.accessToken));
    expect(ok.status).toBe(200);
    expect(ok.body.data.reviewedByUserId).toBe(animalSup.id);
  });

  it('the owner cannot self-approve or self-reject their own publication (403)', async () => {
    const { owner, pub } = await pending();
    const approve = await request(app)
      .post(adminPath(pub.id, '/approve'))
      .set(bearer(owner.accessToken));
    expect(approve.status).toBe(403);
    const reject = await request(app)
      .post(adminPath(pub.id, '/reject'))
      .set(bearer(owner.accessToken))
      .send({ reason: 'nope' });
    expect(reject.status).toBe(403);
  });

  it('a plain authenticated user cannot view the moderation queue (403)', async () => {
    await pending();
    const stranger = await registerUser(app);
    const res = await request(app).get(adminPath()).set(bearer(stranger.accessToken));
    expect(res.status).toBe(403);
  });

  it('re-reviewing an already-approved publication is a 409', async () => {
    const { admin, pub } = await pending();
    await approvePublication(app, admin.accessToken, pub.id);
    const again = await request(app)
      .post(adminPath(pub.id, '/approve'))
      .set(bearer(admin.accessToken));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PUBLICATION_NOT_PENDING');
  });

  it('a removed (INACTIVE) supervisor loses approval access', async () => {
    const { admin, pub } = await pending();
    const sup = await registerAnimalSupervisor(app, admin.accessToken);
    // find + deactivate the assignment
    const list = await request(app)
      .get('/api/v1/admin/supervisors?domain=ANIMAL')
      .set(bearer(admin.accessToken));
    const assignmentId = (list.body.data as Array<{ id: string; userId: string }>).find(
      (a) => a.userId === sup.id,
    )?.id;
    await request(app)
      .delete(`/api/v1/admin/supervisors/${assignmentId}`)
      .set(bearer(admin.accessToken))
      .expect(200);

    const res = await request(app).post(adminPath(pub.id, '/approve')).set(bearer(sup.accessToken));
    expect(res.status).toBe(403);
  });
});

describe('animal publications — visibility & IDOR', () => {
  it('the owner sees all statuses for their animal; a stranger gets 404', async () => {
    const owner = await registerUser(app);
    const admin = await registerAdmin(app);
    const animal = await createAnimal(app, owner.accessToken);
    const lost = await createAnimalPublication(app, owner.accessToken, animal.id, { kind: 'LOST' });
    await request(app)
      .post(adminPath(lost.id, '/reject'))
      .set(bearer(admin.accessToken))
      .send({ reason: 'blurry' });

    const ownerView = await request(app).get(pubPath(animal.id)).set(bearer(owner.accessToken));
    expect(ownerView.status).toBe(200);
    expect(ownerView.body.data).toHaveLength(1);
    expect(ownerView.body.data[0].status).toBe('REJECTED');

    const stranger = await registerUser(app);
    const strangerView = await request(app)
      .get(pubPath(animal.id))
      .set(bearer(stranger.accessToken));
    expect(strangerView.status).toBe(404);
  });

  it('a PENDING publication is not reachable via the public detail endpoint (404)', async () => {
    const owner = await registerUser(app);
    const other = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, { kind: 'LOST' });

    const res = await request(app)
      .get(`/api/v1/animal-publications/${pub.id}`)
      .set(bearer(other.accessToken));
    expect(res.status).toBe(404);
  });

  it('an ANIMAL supervisor may read any animal’s publications, but not a CLINIC supervisor', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    await createAnimalPublication(app, owner.accessToken, animal.id, { kind: 'LOST' });

    const animalSup = await registerAnimalSupervisor(app, admin.accessToken);
    const clinicUser = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, clinicUser.id, 'CLINIC');

    const supView = await request(app).get(pubPath(animal.id)).set(bearer(animalSup.accessToken));
    expect(supView.status).toBe(200);
    expect(supView.body.data).toHaveLength(1);

    const clinicView = await request(app)
      .get(pubPath(animal.id))
      .set(bearer(clinicUser.accessToken));
    expect(clinicView.status).toBe(404);
  });

  it('ownership transfer does not delete an existing publication (documented: it is not reassigned)', async () => {
    const owner = await registerUser(app);
    const newOwner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken);
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, { kind: 'LOST' });

    await transferAnimal(app, owner.accessToken, animal.id, newOwner.id, newOwner.accessToken);

    const row = (await getTestDb()('animal_publications').where({ id: pub.id }).first()) as {
      created_by_user_id: string;
      status: string;
    };
    expect(row).toMatchObject({ created_by_user_id: owner.id, status: 'PENDING' });
  });
});
