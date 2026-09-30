import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  applyToVetJobOffer,
  approveTraderAsAdmin,
  approveVetJobOffer,
  assignSystemSupervisor,
  bearer,
  createActiveOrganization,
  createAnimal,
  createVetJobOffer,
  fixtureBytes,
  registerAdmin,
  registerApprovedVet,
  registerUser,
  setFarmSubscriptionAsAdmin,
  submitTraderRegistration,
} from '../helpers/factories.js';

const { app, container } = buildTestApp();
const API = '/api/v1';

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

describe('clinics / offices — renewal counters + the complete organization file', () => {
  it('the dashboard counts pending renewals per type; the org file carries owner + open renewal', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const clinic = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'CLINIC',
      name: 'عيادة الرحمة',
    });
    const office = await createActiveOrganization(app, owner.accessToken, admin.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'مكتب النور',
    });
    for (const org of [clinic, office]) {
      // a renewal renews an existing (here: expired) subscription
      await setFarmSubscriptionAsAdmin(app, admin.accessToken, org.id, {
        startDate: '2020-01-01',
        endDate: '2020-06-01',
      });
      await request(app)
        .post(`${API}/organizations/${org.id}/subscription-renewals`)
        .set(bearer(owner.accessToken))
        .send({ note: 'تجديد سنوي' })
        .expect(201);
    }

    const summary = await request(app)
      .get(`${API}/admin/dashboard/summary`)
      .set(bearer(admin.accessToken));
    const card = (id: string) =>
      (summary.body.data.cards as Array<{ id: string; pendingRenewals?: number }>).find(
        (c) => c.id === id,
      );
    expect(card('clinics')?.pendingRenewals).toBe(1);
    expect(card('offices')?.pendingRenewals).toBe(1);

    // the type-scoped queue never mixes clinics and offices
    const clinicQueue = await request(app)
      .get(`${API}/admin/organizations/subscription-renewals/pending`)
      .query({ type: 'CLINIC' })
      .set(bearer(admin.accessToken));
    expect(
      (clinicQueue.body.data as Array<{ organizationId: string }>).map((r) => r.organizationId),
    ).toEqual([clinic.id]);

    const file = await request(app)
      .get(`${API}/admin/organizations/${clinic.id}`)
      .set(bearer(admin.accessToken));
    expect(file.status).toBe(200);
    expect(file.body.data.owner).toMatchObject({ id: owner.id, email: owner.email });
    expect(file.body.data.owner).not.toHaveProperty('passwordHash');
    expect(file.body.data.pendingRenewalRequest).toMatchObject({
      organizationId: clinic.id,
      status: 'PENDING',
      note: 'تجديد سنوي',
    });
  });

  it('recent activity is admin-only — a supervisor gets none, and no audit-log access', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, sup.id, 'CLINIC');

    const asAdmin = await request(app)
      .get(`${API}/admin/dashboard/summary`)
      .set(bearer(admin.accessToken));
    expect(asAdmin.body.data.recentActivity.length).toBeGreaterThan(0);

    const asSup = await request(app)
      .get(`${API}/admin/dashboard/summary`)
      .set(bearer(sup.accessToken));
    expect(asSup.status).toBe(200);
    expect(asSup.body.data.recentActivity).toEqual([]);
    await request(app).get(`${API}/admin/audit-logs`).set(bearer(sup.accessToken)).expect(403);
  });
});

describe('jobs — applicants for the admin, caller-relative apply state, private CVs', () => {
  it('admin lists one offer’s applicants; CV links are signed; the detail says "already applied"', async () => {
    const admin = await registerAdmin(app);
    const poster = await registerUser(app);
    const vet = await registerApprovedVet(app);
    const other = await registerApprovedVet(app);
    const offer = await createVetJobOffer(app, poster.accessToken);
    await approveVetJobOffer(app, admin.accessToken, offer.id);
    const otherOffer = await createVetJobOffer(app, poster.accessToken, { title: 'أخرى' });
    await approveVetJobOffer(app, admin.accessToken, otherOffer.id);

    // an application with an uploaded CV
    const presign = await request(app)
      .post(`${API}/vet-jobs/attachments/upload-url`)
      .set(bearer(vet.accessToken))
      .send({ filename: 'cv.pdf', mimeType: 'application/pdf', size: 1024 });
    const cvKey = presign.body.data.storageKey as string;
    await container.objectStorage.put(cvKey, fixtureBytes('application/pdf', 1024), {
      contentType: 'application/pdf',
    });
    const applied = await request(app)
      .post(`${API}/vet-jobs/offers/${offer.id}/applications`)
      .set(bearer(vet.accessToken))
      .send({ fullName: 'د. سارة', phone: '07700000000', experienceYears: 4, cvStorageKey: cvKey });
    expect(applied.status).toBe(201);
    await applyToVetJobOffer(app, other.accessToken, otherOffer.id);

    const list = await request(app)
      .get(`${API}/admin/vet-job-applications`)
      .query({ jobOfferId: offer.id })
      .set(bearer(admin.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ fullName: 'د. سارة', experienceYears: 4 });
    expect(list.body.data[0].cvUrl).toMatch(/op=get|X-Amz-Signature=/);

    // caller-relative state on the public detail
    const asVet = await request(app)
      .get(`${API}/vet-jobs/offers/${offer.id}`)
      .set(bearer(vet.accessToken));
    expect(asVet.body.data.viewer).toEqual({ isPoster: false, applicationStatus: 'PENDING' });
    const asPoster = await request(app)
      .get(`${API}/vet-jobs/offers/${offer.id}`)
      .set(bearer(poster.accessToken));
    expect(asPoster.body.data.viewer).toEqual({ isPoster: true, applicationStatus: null });

    // a second apply is a clean 409, not a crash
    const twice = await applyToVetJobOffer(app, vet.accessToken, offer.id);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('VET_JOB_ALREADY_APPLIED');

    // not for non-moderators
    await request(app)
      .get(`${API}/admin/vet-job-applications`)
      .query({ jobOfferId: offer.id })
      .set(bearer(poster.accessToken))
      .expect(403);
  });

  it('admin messages an applicant through the existing admin → user thread', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const res = await request(app)
      .post(`${API}/admin/users/${vet.id}/messages`)
      .set(bearer(admin.accessToken))
      .send({ body: 'نود التواصل بخصوص طلبك الوظيفي' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data.id).toBeTruthy();
  });
});

describe('admin pets — profiles only, editable', () => {
  it('lists registered pet profiles (not listing-only animals) and edits one', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const pet = await createAnimal(app, owner.accessToken, { name: 'Luna', species: 'CAT' });
    const listingOnly = await createAnimal(app, owner.accessToken, { name: 'Stray' });
    await getTestDb()('animals').where({ id: listingOnly.id }).update({ listing_only: true });

    const list = await request(app).get(`${API}/admin/animals`).set(bearer(admin.accessToken));
    const ids = (list.body.data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toContain(pet.id);
    expect(ids).not.toContain(listingOnly.id);

    const edit = await request(app)
      .patch(`${API}/admin/animals/${pet.id}`)
      .set(bearer(admin.accessToken))
      .send({ name: 'Luna Rose', color: 'رمادي', notes: 'حساسية طعام' });
    expect(edit.status).toBe(200);
    expect(edit.body.data).toMatchObject({
      name: 'Luna Rose',
      color: 'رمادي',
      notes: 'حساسية طعام',
    });

    // a plain user cannot use the admin edit
    await request(app)
      .patch(`${API}/admin/animals/${pet.id}`)
      .set(bearer(owner.accessToken))
      .send({ name: 'x' })
      .expect(403);
  });
});

describe('poultry market — the reviewer sees the full ad and the trader file', () => {
  it('admin ad list includes the seller; trader list carries every stored field', async () => {
    const admin = await registerAdmin(app);
    const trader = await registerUser(app);
    await submitTraderRegistration(app, trader.accessToken, {
      displayName: 'دواجن الشمال',
      whatsapp: '07701234567',
      bio: 'تاجر جملة',
    });
    await approveTraderAsAdmin(app, admin.accessToken, trader.id);

    const traders = await request(app).get(`${API}/admin/traders`).set(bearer(admin.accessToken));
    expect(traders.status).toBe(200);
    expect(traders.body.data[0]).toMatchObject({
      displayName: 'دواجن الشمال',
      whatsapp: '07701234567',
      bio: 'تاجر جملة',
      user: { id: trader.id, email: trader.email },
    });
    expect(traders.body.data[0].termsAcceptedAt).toBeTruthy();

    const offer = await request(app)
      .post(`${API}/poultry-offers`)
      .set(bearer(trader.accessToken))
      .send({
        birdType: 'BROILER',
        quantity: 2000,
        pricingMethod: 'PER_KG',
        price: '3000',
        governorate: 'أربيل',
        phone: '+9647701234567',
        notes: 'تسليم فوري',
      });
    expect(offer.status).toBe(201);

    const ads = await request(app)
      .get(`${API}/admin/poultry-offers`)
      .query({ moderationStatus: 'PENDING' })
      .set(bearer(admin.accessToken));
    expect(ads.status).toBe(200);
    expect(Number(ads.body.data[0].price)).toBe(3000);
    expect(ads.body.data[0]).toMatchObject({
      quantity: 2000,
      notes: 'تسليم فوري',
      seller: { userId: trader.id, displayName: 'دواجن الشمال', email: trader.email },
    });
  });
});

describe('support / consultation threads — image-only replies', () => {
  it('a reply may be an image with no text, but never empty', async () => {
    const owner = await registerUser(app);
    const thread = await request(app)
      .post(`${API}/support-messages`)
      .set(bearer(owner.accessToken))
      .send({ body: 'مشكلة في التطبيق' });
    const id = thread.body.data.id as string;

    const presign = await request(app)
      .post(`${API}/support-messages/attachments/upload-url`)
      .set(bearer(owner.accessToken))
      .send({ filename: 'shot.png', mimeType: 'image/png', size: 1024 });
    expect(presign.status).toBe(201);
    const key = presign.body.data.storageKey as string;
    await container.objectStorage.put(key, fixtureBytes('image/png', 1024), {
      contentType: 'image/png',
    });

    const imageOnly = await request(app)
      .post(`${API}/support-messages/${id}/messages`)
      .set(bearer(owner.accessToken))
      .send({ imageKeys: [key] });
    expect(imageOnly.status).toBe(201);
    expect(imageOnly.body.data.imageUrls ?? imageOnly.body.data.images).toHaveLength(1);

    const empty = await request(app)
      .post(`${API}/support-messages/${id}/messages`)
      .set(bearer(owner.accessToken))
      .send({ body: '   ' });
    expect(empty.status).toBe(422);
  });
});
