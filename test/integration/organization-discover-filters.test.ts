import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  bearer,
  createActiveOrganization,
  registerAdmin,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function patchOrg(id: string, token: string, patch: Record<string, unknown>) {
  const res = await request(app)
    .patch(`/api/v1/organizations/${id}`)
    .set(bearer(token))
    .send(patch);
  if (res.status !== 200) throw new Error(`patch failed ${res.status} ${JSON.stringify(res.body)}`);
}

async function review(orgId: string, rating: number) {
  const reviewer = await registerUser(app);
  const res = await request(app)
    .post(`/api/v1/organizations/${orgId}/reviews`)
    .set(bearer(reviewer.accessToken))
    .send({ rating });
  if (res.status >= 300) throw new Error(`review failed ${res.status} ${JSON.stringify(res.body)}`);
}

describe('GET /organizations/discover — filter sheet (server-side)', () => {
  it('filters offices by country, minimum rating and service; sorts top-rated', async () => {
    const admin = await registerAdmin(app);
    const ownerA = await registerUser(app);
    const ownerB = await registerUser(app);
    const ownerC = await registerUser(app);
    const a = await createActiveOrganization(app, ownerA.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'Office A',
    });
    const b = await createActiveOrganization(app, ownerB.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'Office B',
    });
    const c = await createActiveOrganization(app, ownerC.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'Office C',
    });
    await patchOrg(a.id, ownerA.accessToken, { country: 'العراق', services: ['تطعيم', 'جراحة'] });
    await patchOrg(b.id, ownerB.accessToken, { country: 'العراق', services: ['تغذية'] });
    await patchOrg(c.id, ownerC.accessToken, { country: 'الأردن', services: ['تطعيم'] });
    await review(a.id, 5);
    await review(b.id, 3);
    await review(c.id, 4);

    const viewer = await registerUser(app);
    const ids = async (qs: string) => {
      const res = await request(app)
        .get(`/api/v1/organizations/discover?type=VETERINARY_OFFICE&${qs}`)
        .set(bearer(viewer.accessToken));
      expect(res.status).toBe(200);
      return res.body.data.map((o: { id: string }) => o.id) as string[];
    };

    expect((await ids(`country=${encodeURIComponent('العراق')}`)).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    expect((await ids('minRating=4')).sort()).toEqual([a.id, c.id].sort());
    expect((await ids(`service=${encodeURIComponent('تطعيم')}`)).sort()).toEqual(
      [a.id, c.id].sort(),
    );
    expect(
      await ids(`country=${encodeURIComponent('العراق')}&service=${encodeURIComponent('تطعيم')}`),
    ).toEqual([a.id]);
    expect(await ids('sort=top_rated')).toEqual([a.id, c.id, b.id]);
  });

  it('a LIKE wildcard in the service filter is matched literally', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const org = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'Wild Office',
    });
    await patchOrg(org.id, owner.accessToken, { services: ['تطعيم'] });
    const viewer = await registerUser(app);
    const res = await request(app)
      .get('/api/v1/organizations/discover?type=VETERINARY_OFFICE&service=%25')
      .set(bearer(viewer.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('rejects an out-of-range minRating (422)', async () => {
    const viewer = await registerUser(app);
    const res = await request(app)
      .get('/api/v1/organizations/discover?type=CLINIC&minRating=9')
      .set(bearer(viewer.accessToken));
    expect(res.status).toBe(422);
  });
});
