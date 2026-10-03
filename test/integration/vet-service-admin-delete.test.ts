import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  assignSystemSupervisor,
  bearer,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();
const API = '/api/v1';

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const LISTING = {
  title: 'تلقيح دواجن',
  description: 'خدمة تلقيح وتحصين الدواجن للوقاية من الأمراض وتحسين الإنتاج',
  serviceType: 'VACCINATION',
  animalType: 'POULTRY',
  governorate: 'نينوى',
  priceAmount: '150000',
  priceType: 'APPROXIMATE',
  locationMode: 'FIELD_VISIT',
};

describe('vet services — Admin Management delete', () => {
  it('ADMIN / VET_SERVICE supervisor deletes an APPROVED listing; others cannot', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const other = await registerUser(app);

    const c = await request(app)
      .post(`${API}/vet-services/listings`)
      .set(bearer(vet.accessToken))
      .send(LISTING);
    const id = c.body.data.id as string;
    await request(app)
      .post(`${API}/admin/vet-service-listings/${id}/approve`)
      .set(bearer(admin.accessToken));

    // the owner vet + an unrelated user lack vet_service.delete on the admin route
    for (const token of [vet.accessToken, other.accessToken]) {
      const denied = await request(app)
        .delete(`${API}/admin/vet-service-listings/${id}`)
        .set(bearer(token));
      expect(denied.status).toBe(403);
    }

    const sup = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, sup.id, 'VET_SERVICE');
    const del = await request(app)
      .delete(`${API}/admin/vet-service-listings/${id}`)
      .set(bearer(sup.accessToken));
    expect(del.status).toBe(200);

    const gone = await request(app)
      .get(`${API}/vet-services/listings/${id}`)
      .set(bearer(other.accessToken));
    expect(gone.status).toBe(404);
  });

  it('a non-vet and another vet can both contact / request an approved listing', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const vet2 = await registerApprovedVet(app);
    const owner = await registerUser(app);

    const c = await request(app)
      .post(`${API}/vet-services/listings`)
      .set(bearer(vet.accessToken))
      .send(LISTING);
    const id = c.body.data.id as string;
    await request(app)
      .post(`${API}/admin/vet-service-listings/${id}/approve`)
      .set(bearer(admin.accessToken));

    for (const token of [owner.accessToken, vet2.accessToken]) {
      const chat = await request(app)
        .post(`${API}/vet-services/listings/${id}/conversation`)
        .set(bearer(token));
      expect(chat.status).toBe(201);
      expect(chat.body.data.conversationId).toBeTruthy();
    }
    // the provider cannot contact their own listing
    const self = await request(app)
      .post(`${API}/vet-services/listings/${id}/conversation`)
      .set(bearer(vet.accessToken));
    expect(self.status).toBe(403);
  });
});
