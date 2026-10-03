import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { bearer, registerAdmin, registerUser, seedPublishedTip } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

async function publishedNews(token: string, body: Record<string, unknown>): Promise<string> {
  const res = await request(app).post('/api/v1/admin/news').set(bearer(token)).send(body);
  expect(res.status).toBe(201);
  await request(app)
    .post(`/api/v1/admin/news/${res.body.data.id}/publish`)
    .set(bearer(token))
    .expect(200);
  return res.body.data.id as string;
}

const titles = (res: request.Response): string[] =>
  (res.body.data as { title: string }[]).map((x) => x.title).sort();

describe('News & Best Tips — separated per animal section', () => {
  it('each section feed lists only its own news; general items stay in the global list', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    await publishedNews(admin.accessToken, { title: 'أخبار الدواجن', animalSection: 'POULTRY' });
    await publishedNews(admin.accessToken, { title: 'أخبار الأغنام', animalSection: 'SHEEP' });
    await publishedNews(admin.accessToken, { title: 'أخبار الأبقار', animalSection: 'CATTLE' });
    await publishedNews(admin.accessToken, {
      title: 'أخبار الحيوانات الأليفة',
      animalSection: 'PETS',
    });
    await publishedNews(admin.accessToken, { title: 'خبر عام' });

    const get = (q: string) => request(app).get(`/api/v1/news${q}`).set(bearer(user.accessToken));
    expect(titles(await get('?section=POULTRY'))).toEqual(['أخبار الدواجن']);
    expect(titles(await get('?section=PETS'))).toEqual(['أخبار الحيوانات الأليفة']);
    expect(titles(await get('?section=SHEEP,CATTLE'))).toEqual(
      ['أخبار الأبقار', 'أخبار الأغنام'].sort(),
    );
    expect(await get('')).toHaveProperty('body.data.length', 5);
    expect((await get('?section=DOGS')).status).toBe(422);

    // an editor can move an item between sections, or back to general
    const list = await get('?section=POULTRY');
    const id = list.body.data[0].id as string;
    expect(list.body.data[0].animalSection).toBe('POULTRY');
    await request(app)
      .patch(`/api/v1/admin/news/${id}`)
      .set(bearer(admin.accessToken))
      .send({ animalSection: null })
      .expect(200);
    expect(titles(await get('?section=POULTRY'))).toEqual([]);
  });

  it('tips are separated the same way', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);
    await seedPublishedTip(app, admin.accessToken, {
      title: 'نصيحة للدواجن',
      animalSection: 'POULTRY',
    });
    await seedPublishedTip(app, admin.accessToken, { title: 'نصيحة للقطط', animalSection: 'PETS' });
    await seedPublishedTip(app, admin.accessToken, { title: 'نصيحة عامة' });

    const get = (q: string) => request(app).get(`/api/v1/tips${q}`).set(bearer(user.accessToken));
    expect(titles(await get('?section=PETS'))).toEqual(['نصيحة للقطط']);
    expect(titles(await get('?section=POULTRY'))).toEqual(['نصيحة للدواجن']);
    expect(titles(await get(''))).toHaveLength(3);
  });
});
