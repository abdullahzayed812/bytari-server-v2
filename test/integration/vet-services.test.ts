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
  district: 'الموصل',
  priceAmount: '150000',
  priceType: 'APPROXIMATE',
  locationMode: 'FIELD_VISIT',
  details: ['متابعة وتنظيم القطيع قبل التطعيم', 'تقديم اللقاحات المناسبة حسب العمر'],
};

const REQUEST = {
  title: 'طلب تلقيح وتحسين دواجن',
  description: 'أبحث عن طبيب بيطري لديه خبرة في تلقيح الدواجن وتحسين صحتها في مزرعتي',
  animalType: 'POULTRY',
  serviceType: 'VACCINATION',
  animalCount: 250,
  animalAge: '30 يوم',
  governorate: 'نينوى',
  district: 'الموصل',
  needsFieldVisit: true,
  budgetAmount: '80000',
  urgency: 'NORMAL',
};

async function approveListing(app_: typeof app, adminToken: string, id: string) {
  return request(app_).post(`${API}/admin/vet-service-listings/${id}/approve`).set(bearer(adminToken));
}
async function approveRequest(app_: typeof app, adminToken: string, id: string) {
  return request(app_).post(`${API}/admin/vet-service-requests/${id}/approve`).set(bearer(adminToken));
}

describe('vet services — listings (vet-published, moderated)', () => {
  it('only an APPROVED vet can create a listing; it starts PENDING and is not public', async () => {
    const vet = await registerApprovedVet(app);
    const owner = await registerUser(app);

    const asOwner = await request(app)
      .post(`${API}/vet-services/listings`)
      .set(bearer(owner.accessToken))
      .send(LISTING);
    expect(asOwner.status).toBe(403);

    const created = await request(app)
      .post(`${API}/vet-services/listings`)
      .set(bearer(vet.accessToken))
      .send(LISTING);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: 'PENDING', title: 'تلقيح دواجن' });

    // not in the public browse yet
    const browse = await request(app)
      .get(`${API}/vet-services/listings`)
      .set(bearer(owner.accessToken));
    expect(browse.body.data).toHaveLength(0);

    // the vet sees it under "my listings" with its status
    const mine = await request(app)
      .get(`${API}/vet-services/listings/mine`)
      .set(bearer(vet.accessToken));
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].status).toBe('PENDING');
  });

  it('ADMIN / VET_SERVICE supervisor approves + rejects; the creator cannot', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const c = await request(app)
      .post(`${API}/vet-services/listings`)
      .set(bearer(vet.accessToken))
      .send(LISTING);
    const id = c.body.data.id;

    // the creator cannot approve their own (no vet_service.approve permission)
    const selfApprove = await approveListing(app, vet.accessToken, id);
    expect(selfApprove.status).toBe(403);

    const ok = await approveListing(app, admin.accessToken, id);
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('APPROVED');

    // now public
    const browse = await request(app)
      .get(`${API}/vet-services/listings`)
      .set(bearer(vet.accessToken));
    expect(browse.body.data).toHaveLength(1);

    // reject a second listing WITH reason; the vet sees the reason
    const c2 = await request(app)
      .post(`${API}/vet-services/listings`)
      .set(bearer(vet.accessToken))
      .send({ ...LISTING, title: 'فحص أبقار' });
    const rej = await request(app)
      .post(`${API}/admin/vet-service-listings/${c2.body.data.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'المعلومات غير كافية' });
    expect(rej.status).toBe(200);
    expect(rej.body.data).toMatchObject({ status: 'REJECTED', rejectionReason: 'المعلومات غير كافية' });

    // a VET_SERVICE supervisor (non-admin) can also moderate
    const sup = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, sup.id, 'VET_SERVICE');
    const queue = await request(app)
      .get(`${API}/admin/vet-service-listings?status=PENDING`)
      .set(bearer(sup.accessToken));
    expect(queue.status).toBe(200);
  });
});

describe('vet services — pet-owner requests + vet offers (Flow B)', () => {
  it('request → moderation → vet offer → owner accepts → conversation opens → complete', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const vet = await registerApprovedVet(app);

    const rc = await request(app)
      .post(`${API}/vet-services/requests`)
      .set(bearer(owner.accessToken))
      .send(REQUEST);
    expect(rc.status).toBe(201);
    expect(rc.body.data.requestNumber).toMatch(/^REQ-\d{4}-\d{5}$/);
    const requestId = rc.body.data.id;

    // not public, and a vet cannot offer on a PENDING request
    const earlyOffer = await request(app)
      .post(`${API}/vet-services/requests/${requestId}/offers`)
      .set(bearer(vet.accessToken))
      .send({ proposedAmount: '150000' });
    expect(earlyOffer.status).toBe(409);

    await approveRequest(app, admin.accessToken, requestId);

    // owner cannot offer on their own request
    const selfOffer = await request(app)
      .post(`${API}/vet-services/requests/${requestId}/offers`)
      .set(bearer(owner.accessToken))
      .send({ proposedAmount: '150000' });
    expect(selfOffer.status).toBe(403);

    const offer = await request(app)
      .post(`${API}/vet-services/requests/${requestId}/offers`)
      .set(bearer(vet.accessToken))
      .send({ proposedAmount: '150000', expectedDuration: 'ساعتان', details: 'أشمل زيارة ميدانية' });
    expect(offer.status).toBe(201);
    const offerId = offer.body.data.id;

    // the request owner sees the offer; a stranger does not
    const stranger = await registerUser(app);
    expect(
      (await request(app).get(`${API}/vet-services/requests/${requestId}/offers`).set(bearer(stranger.accessToken))).status,
    ).toBe(404);
    const owned = await request(app)
      .get(`${API}/vet-services/requests/${requestId}/offers`)
      .set(bearer(owner.accessToken));
    expect(owned.body.data).toHaveLength(1);

    // accept → conversation created + pinned
    const accepted = await request(app)
      .post(`${API}/vet-services/offers/${offerId}/accept`)
      .set(bearer(owner.accessToken));
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe('ACCEPTED');
    const conversationId = accepted.body.data.conversationId as string;
    expect(conversationId).toBeTruthy();

    // both parties can message the deal conversation
    const vetMsg = await request(app)
      .post(`${API}/conversations/${conversationId}/messages`)
      .set(bearer(vet.accessToken))
      .send({ body: 'وعليكم السلام، أقدر أزور المزرعة غداً 10 صباحاً' });
    expect(vetMsg.status).toBe(201);
    const conv = await request(app)
      .get(`${API}/conversations/${conversationId}`)
      .set(bearer(owner.accessToken));
    expect(conv.body.data).toMatchObject({
      type: 'PET_OWNER_VETERINARIAN',
      status: 'OPEN',
      subjectType: 'VET_SERVICE_OFFER',
      subjectId: offerId,
    });

    // a stranger cannot read the conversation
    expect(
      (await request(app).get(`${API}/conversations/${conversationId}`).set(bearer(stranger.accessToken))).status,
    ).toBe(404);

    // "إنهاء الطلب" — the vet completes it
    const done = await request(app)
      .post(`${API}/vet-services/offers/${offerId}/complete`)
      .set(bearer(vet.accessToken));
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('COMPLETED');
    const convAfter = await request(app)
      .get(`${API}/conversations/${conversationId}`)
      .set(bearer(owner.accessToken));
    expect(convAfter.body.data.status).toBe('COMPLETED');

    // "إيقاف المحادثة" then messaging is blocked
    await request(app).post(`${API}/conversations/${conversationId}/close`).set(bearer(owner.accessToken));
    const blocked = await request(app)
      .post(`${API}/conversations/${conversationId}/messages`)
      .set(bearer(vet.accessToken))
      .send({ body: 'مرحبا' });
    expect(blocked.status).toBe(403);
  });

  it('accepting one offer auto-rejects the other pending offers', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const vetA = await registerApprovedVet(app);
    const vetB = await registerApprovedVet(app);
    const rc = await request(app).post(`${API}/vet-services/requests`).set(bearer(owner.accessToken)).send(REQUEST);
    const requestId = rc.body.data.id;
    await approveRequest(app, admin.accessToken, requestId);

    const oA = await request(app)
      .post(`${API}/vet-services/requests/${requestId}/offers`)
      .set(bearer(vetA.accessToken))
      .send({ proposedAmount: '150000' });
    const oB = await request(app)
      .post(`${API}/vet-services/requests/${requestId}/offers`)
      .set(bearer(vetB.accessToken))
      .send({ proposedAmount: '140000' });

    await request(app).post(`${API}/vet-services/offers/${oA.body.data.id}/accept`).set(bearer(owner.accessToken));

    const bAfter = await request(app)
      .get(`${API}/vet-services/offers/${oB.body.data.id}`)
      .set(bearer(vetB.accessToken));
    expect(bAfter.body.data.status).toBe('REJECTED');
  });
});

describe('vet services — pet-owner requests a listing (Flow A)', () => {
  it('owner requests a listing → vet accepts on the "الموافقة" queue → conversation', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const owner = await registerUser(app);

    const lc = await request(app).post(`${API}/vet-services/listings`).set(bearer(vet.accessToken)).send(LISTING);
    const listingId = lc.body.data.id;
    await approveListing(app, admin.accessToken, listingId);

    // the vet cannot request their own listing
    const selfReq = await request(app)
      .post(`${API}/vet-services/listings/${listingId}/requests`)
      .set(bearer(vet.accessToken))
      .send({ animalType: 'POULTRY', animalCount: 1000, needsFieldVisit: true });
    expect(selfReq.status).toBe(403);

    const lr = await request(app)
      .post(`${API}/vet-services/listings/${listingId}/requests`)
      .set(bearer(owner.accessToken))
      .send({ animalType: 'POULTRY', animalCount: 1000, animalAge: '35 يوم', needsFieldVisit: true, previousVisit: true });
    expect(lr.status).toBe(201);
    const listingRequestId = lr.body.data.id;

    // vet's "الموافقة على الخدمة" queue
    const received = await request(app)
      .get(`${API}/vet-services/listing-requests/received?status=PENDING`)
      .set(bearer(vet.accessToken));
    expect(received.body.data).toHaveLength(1);

    // owner's "طلباتي"
    const mineReq = await request(app)
      .get(`${API}/vet-services/listing-requests/mine`)
      .set(bearer(owner.accessToken));
    expect(mineReq.body.data).toHaveLength(1);

    const accepted = await request(app)
      .post(`${API}/vet-services/listing-requests/${listingRequestId}/accept`)
      .set(bearer(vet.accessToken));
    expect(accepted.status).toBe(200);
    expect(accepted.body.data).toMatchObject({ status: 'ACCEPTED' });
    expect(accepted.body.data.conversationId).toBeTruthy();
  });

  it('"تواصل مع الطبيب" opens a deal conversation before any request', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const owner = await registerUser(app);
    const lc = await request(app).post(`${API}/vet-services/listings`).set(bearer(vet.accessToken)).send(LISTING);
    await approveListing(app, admin.accessToken, lc.body.data.id);

    const conv = await request(app)
      .post(`${API}/vet-services/listings/${lc.body.data.id}/conversation`)
      .set(bearer(owner.accessToken));
    expect(conv.status).toBe(201);
    expect(conv.body.data.conversationId).toBeTruthy();

    // idempotent — same conversation on a repeat
    const conv2 = await request(app)
      .post(`${API}/vet-services/listings/${lc.body.data.id}/conversation`)
      .set(bearer(owner.accessToken));
    expect(conv2.body.data.conversationId).toBe(conv.body.data.conversationId);
  });
});
