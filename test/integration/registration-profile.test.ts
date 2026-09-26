import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { bearer, registerUser, uniqueEmail } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const base = () => ({
  email: uniqueEmail(),
  password: 'a-very-strong-password',
  firstName: 'Ali',
  lastName: 'Hassan',
  phone: '+9647712345678',
});

describe('POST /auth/register — phone, country → governorate, specialization', () => {
  it('requires a phone number (422 without it)', async () => {
    const { phone: _omit, ...body } = base();
    const res = await request(app).post('/api/v1/auth/register').send(body);
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain('body.phone');
  });

  it('rejects a malformed phone number', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...base(), phone: 'call-me' });
    expect(res.status).toBe(422);
  });

  it('stores the phone, country and an Iraqi governorate', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...base(), country: 'IQ', governorate: 'البصرة' });
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({
      phone: '+9647712345678',
      country: 'IQ',
      governorate: 'البصرة',
    });
  });

  it('rejects a governorate that is not in the selected country list', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...base(), country: 'IQ', governorate: 'Riyadh' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(
      'body.governorate',
    );
  });

  it('requires a governorate once a country is chosen, and a country for a governorate', async () => {
    const noGov = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...base(), country: 'IQ' });
    expect(noGov.status).toBe(422);
    const noCountry = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...base(), governorate: 'بغداد' });
    expect(noCountry.status).toBe(422);
  });

  it('stores an optional specialization for a veterinarian signup and exposes it publicly', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        ...base(),
        accountType: 'VETERINARIAN',
        country: 'IQ',
        governorate: 'بغداد',
        specialization: 'جراحة الحيوانات الأليفة',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.user.specialization).toBe('جراحة الحيوانات الأليفة');

    const viewer = await registerUser(app);
    const summary = await request(app)
      .get(`/api/v1/users/${res.body.data.user.id as string}`)
      .set(bearer(viewer.accessToken));
    expect(summary.body.data.specialization).toBe('جراحة الحيوانات الأليفة');
  });

  it('specialization is optional for a veterinarian signup', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...base(), accountType: 'VETERINARIAN' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.specialization).toBeNull();
  });

  it('never stores a specialization for a Pet Owner signup', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...base(), specialization: 'surgery' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.specialization).toBeNull();
  });
});
