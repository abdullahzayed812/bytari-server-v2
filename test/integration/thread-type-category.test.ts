import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { AiResponderPort } from '../../src/modules/consultations/index.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  bearer,
  createAnimal,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  setAiSettings,
} from '../helpers/factories.js';

class StubAiResponder implements AiResponderPort {
  calls = 0;
  generate(): Promise<string | null> {
    this.calls += 1;
    return Promise.resolve('AI reply');
  }
}

const ai = new StubAiResponder();
const { app } = buildTestApp({ aiResponder: ai });

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  await getTestDb()('ai_settings').update({ enabled: false });
  ai.calls = 0;
});
afterAll(() => closeTestDb());

describe('consultation — generic animal type (not restricted to owned animals)', () => {
  it('creates a consultation with only an animal type, no owned animal', async () => {
    const user = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/consultations')
      .set(bearer(user.accessToken))
      .send({ body: 'My goat stopped eating since yesterday', animalType: 'GOAT' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ animalId: null, animalType: 'GOAT' });
  });

  it('still accepts an owned animal together with a type, and rejects a foreign animal', async () => {
    const owner = await registerUser(app);
    const other = await registerUser(app);
    const pet = await createAnimal(app, owner.accessToken, { species: 'CAT' });

    const ok = await request(app)
      .post('/api/v1/consultations')
      .set(bearer(owner.accessToken))
      .send({ body: 'Cat sneezing', animalId: pet.id, animalType: 'CAT' });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ animalId: pet.id, animalType: 'CAT' });

    const foreign = await request(app)
      .post('/api/v1/consultations')
      .set(bearer(other.accessToken))
      .send({ body: 'not mine', animalId: pet.id, animalType: 'CAT' });
    expect(foreign.status).toBe(400);
  });

  it('rejects an unknown animal type (422)', async () => {
    const user = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/consultations')
      .set(bearer(user.accessToken))
      .send({ body: 'x', animalType: 'DRAGON' });
    expect(res.status).toBe(422);
  });

  it('legacy body-only consultations keep working', async () => {
    const user = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/consultations')
      .set(bearer(user.accessToken))
      .send({ body: 'plain question' });
    expect(res.status).toBe(201);
    expect(res.body.data.animalType).toBeNull();
  });
});

describe('inquiry — category', () => {
  it('stores a valid category and filters the list by it', async () => {
    const vet = await registerApprovedVet(app);
    const a = await request(app)
      .post('/api/v1/inquiries')
      .set(bearer(vet.accessToken))
      .send({ body: 'Dose of meloxicam for dogs?', category: 'MEDICATION' });
    expect(a.status).toBe(201);
    expect(a.body.data.category).toBe('MEDICATION');

    await request(app)
      .post('/api/v1/inquiries')
      .set(bearer(vet.accessToken))
      .send({ body: 'Emergency bloat', category: 'EMERGENCY' });

    const list = await request(app)
      .get('/api/v1/inquiries?category=MEDICATION')
      .set(bearer(vet.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].category).toBe('MEDICATION');
  });

  it('defaults to GENERAL when omitted, rejects an unknown category (422)', async () => {
    const vet = await registerApprovedVet(app);
    const def = await request(app)
      .post('/api/v1/inquiries')
      .set(bearer(vet.accessToken))
      .send({ body: 'no category' });
    expect(def.status).toBe(201);
    expect(def.body.data.category).toBe('GENERAL');

    const bad = await request(app)
      .post('/api/v1/inquiries')
      .set(bearer(vet.accessToken))
      .send({ body: 'x', category: 'ASTROLOGY' });
    expect(bad.status).toBe(422);
  });
});

describe('thread list cards — opening-message preview as the title', () => {
  it('returns the start of the first message on list and detail', async () => {
    const user = await registerUser(app);
    const long = `My cat has stopped eating ${'and drinking '.repeat(30)}`;
    const created = await request(app)
      .post('/api/v1/consultations')
      .set(bearer(user.accessToken))
      .send({ body: long, animalType: 'CAT' });
    expect(created.body.data.preview).toBe(long.slice(0, 140));

    // a follow-up message must not replace the opener as the preview
    await request(app)
      .post(`/api/v1/consultations/${created.body.data.id as string}/messages`)
      .set(bearer(user.accessToken))
      .send({ body: 'follow-up' });

    const list = await request(app).get('/api/v1/consultations').set(bearer(user.accessToken));
    expect(list.body.data[0].preview.startsWith('My cat has stopped eating')).toBe(true);
    expect(list.body.data[0].preview.length).toBeLessThanOrEqual(140);
  });
});

describe('AI reply switch — enforced by the backend', () => {
  it('no AI reply while disabled; a reply once the admin enables it', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);

    const off = await request(app)
      .post('/api/v1/consultations')
      .set(bearer(user.accessToken))
      .send({ body: 'first', animalType: 'DOG' });
    expect(off.body.data.aiResponded).toBe(false);
    expect(ai.calls).toBe(0);

    expect(
      (await setAiSettings(app, admin.accessToken, { consultationAiEnabled: true })).status,
    ).toBe(200);
    const on = await request(app)
      .post('/api/v1/consultations')
      .set(bearer(user.accessToken))
      .send({ body: 'second', animalType: 'DOG' });
    expect(on.body.data.aiResponded).toBe(true);
    expect(ai.calls).toBe(1);

    // the inquiry switch is independent
    const vet = await registerApprovedVet(app);
    const inq = await request(app)
      .post('/api/v1/inquiries')
      .set(bearer(vet.accessToken))
      .send({ body: 'q', category: 'GENERAL' });
    expect(inq.body.data.aiResponded).toBe(false);

    const audit = await getTestDb()('audit_logs').where({ action: 'AI_SETTING_UPDATED' });
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it('a non-admin cannot flip the switch (403)', async () => {
    const user = await registerUser(app);
    expect((await setAiSettings(app, user.accessToken, { inquiryAiEnabled: true })).status).toBe(
      403,
    );
  });
});
