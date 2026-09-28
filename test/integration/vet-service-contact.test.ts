import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import { bearer, registerAdmin, registerApprovedVet, registerUser } from '../helpers/factories.js';

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
  district: 'الموصل',
  priceAmount: '150000',
  priceType: 'APPROXIMATE',
  locationMode: 'FIELD_VISIT',
  details: ['متابعة وتنظيم القطيع قبل التطعيم'],
};

describe('vet services — request the service, then contact through the existing chat', () => {
  it('owner requests a listing; both parties (only) can open the deal chat while it is still PENDING', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const owner = await registerUser(app);
    const stranger = await registerUser(app);

    const listing = await request(app)
      .post(`${API}/vet-services/listings`)
      .set(bearer(vet.accessToken))
      .send(LISTING);
    expect(listing.status).toBe(201);
    await request(app)
      .post(`${API}/admin/vet-service-listings/${listing.body.data.id}/approve`)
      .set(bearer(admin.accessToken));

    const lr = await request(app)
      .post(`${API}/vet-services/listings/${listing.body.data.id}/requests`)
      .set(bearer(owner.accessToken))
      .send({ animalType: 'POULTRY', animalCount: 200, notes: 'أحتاج تلقيحاً عاجلاً' });
    expect(lr.status).toBe(201);
    expect(lr.body.data.status).toBe('PENDING');
    const lrId = lr.body.data.id as string;

    // The provider sees it among received requests.
    const received = await request(app)
      .get(`${API}/vet-services/listing-requests/received`)
      .set(bearer(vet.accessToken));
    expect(received.body.data.map((x: { id: string }) => x.id)).toContain(lrId);

    const vetChat = await request(app)
      .post(`${API}/vet-services/listing-requests/${lrId}/conversation`)
      .set(bearer(vet.accessToken));
    expect(vetChat.status).toBe(200);
    const ownerChat = await request(app)
      .post(`${API}/vet-services/listing-requests/${lrId}/conversation`)
      .set(bearer(owner.accessToken));
    // Same conversation for both sides (reused, not duplicated).
    expect(ownerChat.body.data.conversationId).toBe(vetChat.body.data.conversationId);

    const msg = await request(app)
      .post(`${API}/conversations/${vetChat.body.data.conversationId}/messages`)
      .set(bearer(vet.accessToken))
      .send({ body: 'مرحباً، متى يناسبك الموعد؟' });
    expect(msg.status).toBe(201);

    const intruder = await request(app)
      .post(`${API}/vet-services/listing-requests/${lrId}/conversation`)
      .set(bearer(stranger.accessToken));
    expect(intruder.status).toBe(404);
    const peek = await request(app)
      .get(`${API}/conversations/${vetChat.body.data.conversationId}/messages`)
      .set(bearer(stranger.accessToken));
    expect(peek.status).toBe(404);
  });
});
