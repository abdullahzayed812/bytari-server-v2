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
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const adminPath = (id?: string, suffix = ''): string =>
  `/api/v1/admin/animal-publications${id ? `/${id}` : ''}${suffix}`;

async function seed(kind: 'LOST' | 'ADOPTION' | 'MATING') {
  const admin = await registerAdmin(app);
  const owner = await registerUser(app);
  const animal = await createAnimal(app, owner.accessToken);
  const pub = await createAnimalPublication(app, owner.accessToken, animal.id, { kind });
  return { admin, owner, animal, pub };
}

describe.each(['LOST', 'ADOPTION', 'MATING'] as const)('admin %s listing management', (kind) => {
  it('admin lists, opens, edits, approves and deletes the listing', async () => {
    const { admin, pub } = await seed(kind);

    const list = await request(app)
      .get(`${adminPath()}?kind=${kind}`)
      .set(bearer(admin.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.map((p: { id: string }) => p.id)).toContain(pub.id);

    const detail = await request(app).get(adminPath(pub.id)).set(bearer(admin.accessToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.kind).toBe(kind);

    const edited = await request(app)
      .patch(adminPath(pub.id))
      .set(bearer(admin.accessToken))
      .send({ contactName: 'Edited Name', contactPhone: '07709998888' });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({
      contactName: 'Edited Name',
      contactPhone: '07709998888',
      status: 'PENDING',
    });

    await approvePublication(app, admin.accessToken, pub.id);
    const del = await request(app)
      .delete(`/api/v1/animal-publications/${pub.id}`)
      .set(bearer(admin.accessToken));
    expect(del.status).toBe(200);
    expect((await request(app).get(adminPath(pub.id)).set(bearer(admin.accessToken))).status).toBe(
      404,
    );
  });
});

describe('admin publication edit — rules', () => {
  it('refuses fields foreign to the kind', async () => {
    const { admin, pub } = await seed('ADOPTION');
    const res = await request(app)
      .patch(adminPath(pub.id))
      .set(bearer(admin.accessToken))
      .send({ lostDistrict: 'X' });
    expect(res.status).toBe(400);
  });

  it('reverses a decision: APPROVED → REJECTED (hidden) → APPROVED (public), audited', async () => {
    const { admin, owner, pub } = await seed('MATING');
    await approvePublication(app, admin.accessToken, pub.id);

    const noReason = await request(app)
      .patch(adminPath(pub.id))
      .set(bearer(admin.accessToken))
      .send({ status: 'REJECTED' });
    expect(noReason.status).toBe(400);

    const hidden = await request(app)
      .patch(adminPath(pub.id))
      .set(bearer(admin.accessToken))
      .send({ status: 'REJECTED', rejectionReason: 'policy' });
    expect(hidden.status).toBe(200);
    expect(hidden.body.data).toMatchObject({ status: 'REJECTED', rejectionReason: 'policy' });
    const browse = await request(app)
      .get('/api/v1/animal-publications?kind=MATING')
      .set(bearer(owner.accessToken));
    expect(browse.body.data).toHaveLength(0);

    const back = await request(app)
      .patch(adminPath(pub.id))
      .set(bearer(admin.accessToken))
      .send({ status: 'APPROVED' });
    expect(back.body.data).toMatchObject({ status: 'APPROVED', rejectionReason: null });

    const audits = await getTestDb()('audit_logs')
      .where({ action: 'ANIMAL_PUBLICATION_UPDATED', entity_id: pub.id })
      .count<{ count: string }[]>({ count: '*' });
    expect(Number(audits[0]?.count)).toBe(2);
  });

  it('PENDING is not a valid target status', async () => {
    const { admin, pub } = await seed('LOST');
    const res = await request(app)
      .patch(adminPath(pub.id))
      .set(bearer(admin.accessToken))
      .send({ status: 'PENDING' });
    expect(res.status).toBe(422);
  });

  it('owner / stranger cannot edit (403); ANIMAL supervisor can; unknown id 404', async () => {
    const { admin, owner, pub } = await seed('LOST');
    const stranger = await registerUser(app);
    for (const u of [owner, stranger]) {
      const res = await request(app)
        .patch(adminPath(pub.id))
        .set(bearer(u.accessToken))
        .send({ contactName: 'Hacker' });
      expect(res.status).toBe(403);
    }
    const sup = await registerAnimalSupervisor(app, admin.accessToken);
    const ok = await request(app)
      .patch(adminPath(pub.id))
      .set(bearer(sup.accessToken))
      .send({ healthNotes: 'limping' });
    expect(ok.status).toBe(200);
    const missing = await request(app)
      .patch(adminPath('7cac6e9c-c914-4fbd-ad2c-07a6cbe4fc02'))
      .set(bearer(admin.accessToken))
      .send({ contactName: 'Nobody' });
    expect(missing.status).toBe(404);
  });
});
