import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  assignSystemSupervisor,
  bearer,
  createAdCampaign,
  createAnimal,
  createAnimalPublication,
  createFarm,
  createOrganization,
  createVetCourse,
  createVetJobOffer,
  createVetJobSeekerProfile,
  registerAdmin,
  registerApprovedTrader,
  registerApprovedVet,
  registerUser,
  submitTraderRegistration,
  type RegisteredUser,
} from '../helpers/factories.js';

/**
 * §18 — every Admin management list searches server-side, within its own
 * section, and keeps its existing filters / pagination / permissions.
 */
const { app } = buildTestApp();
const API = '/api/v1';

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const ids = (res: request.Response): string[] => res.body.data.map((r: { id: string }) => r.id);

async function get(admin: RegisteredUser, path: string): Promise<request.Response> {
  const res = await request(app).get(`${API}${path}`).set(bearer(admin.accessToken));
  expect(res.status, `${path} → ${JSON.stringify(res.body)}`).toBe(200);
  return res;
}

describe('admin section search', () => {
  it('users: by phone, by "first last" full name, and by id; wildcards match literally', async () => {
    const admin = await registerAdmin(app);
    const target = await registerUser(app, { firstName: 'سارة', lastName: 'الكبيسي' });
    await getTestDb()('users').where({ id: target.id }).update({ phone: '+9647811112222' });
    const other = await registerUser(app);

    expect(ids(await get(admin, '/admin/users?search=7811112222'))).toEqual([target.id]);
    expect(
      ids(await get(admin, `/admin/users?search=${encodeURIComponent('سارة الكبيسي')}`)),
    ).toEqual([target.id]);
    expect(ids(await get(admin, `/admin/users?search=${target.id}`))).toEqual([target.id]);
    // `%` is a literal character, not "match everything".
    expect(ids(await get(admin, '/admin/users?search=%25'))).not.toContain(other.id);
  });

  it('organizations: by owner email, scoped to ?type=, on the default and the pending tab', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const otherOwner = await registerApprovedVet(app);
    const clinic = await createOrganization(app, owner.accessToken, {
      type: 'CLINIC',
      name: 'عيادة النور',
    });
    const office = await createOrganization(app, owner.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'مكتب النور',
    });
    const unrelated = await createOrganization(app, otherOwner.accessToken, {
      type: 'CLINIC',
      name: 'عيادة الأمل',
    });

    const byOwner = await get(
      admin,
      `/admin/organizations?type=CLINIC&search=${encodeURIComponent(owner.email)}`,
    );
    expect(ids(byOwner)).toEqual([clinic.id]);
    expect(byOwner.body.meta.total).toBe(1);

    const byName = await get(admin, `/admin/organizations?search=${encodeURIComponent('النور')}`);
    expect(ids(byName).sort()).toEqual([clinic.id, office.id].sort());

    // The pending tab now honours the section's type and the search term.
    const pending = await get(
      admin,
      `/admin/organizations/pending?type=CLINIC&search=${encodeURIComponent('عيادة')}`,
    );
    expect(ids(pending).sort()).toEqual([clinic.id, unrelated.id].sort());
    expect(ids(pending)).not.toContain(office.id);
  });

  it('farms: by owner name and by join code; species scope still applies', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app, { firstName: 'مهند', lastName: 'الدليمي' });
    const farm = await createFarm(app, owner.accessToken, admin.accessToken, { name: 'حقل أ' });
    const otherOwner = await registerUser(app);
    await createFarm(app, otherOwner.accessToken, admin.accessToken, { name: 'حقل ب' });

    const byOwner = await get(
      admin,
      `/admin/organizations/farms?speciesGroup=POULTRY&search=${encodeURIComponent('مهند')}`,
    );
    expect(byOwner.body.data.map((f: { organizationId: string }) => f.organizationId)).toEqual([
      farm.id,
    ]);
    const byCode = await get(admin, `/admin/organizations/farms?search=${farm.joinCode}`);
    expect(byCode.body.data).toHaveLength(1);
    const sheepOnly = await get(
      admin,
      `/admin/organizations/farms?speciesGroup=SHEEP&search=${encodeURIComponent('مهند')}`,
    );
    expect(sheepOnly.body.data).toHaveLength(0);
  });

  it('veterinarian applications, traders and supervisors: by the person', async () => {
    const admin = await registerAdmin(app);
    const applicant = await registerUser(app, { firstName: 'زيد', lastName: 'المتقدم' });
    const bystander = await registerUser(app);
    await getTestDb()('veterinarian_applications').insert([
      { user_id: applicant.id, status: 'PENDING' },
      { user_id: bystander.id, status: 'PENDING' },
    ]);
    const vets = await get(
      admin,
      `/admin/veterinarians/pending?search=${encodeURIComponent('زيد')}`,
    );
    expect(vets.body.data.map((a: { userId: string }) => a.userId)).toEqual([applicant.id]);

    const trader = await registerUser(app);
    expect(
      (await submitTraderRegistration(app, trader.accessToken, { displayName: 'دواجن الفرات' }))
        .status,
    ).toBe(201);
    await registerApprovedTrader(app);
    const traders = await get(admin, `/admin/traders?search=${encodeURIComponent('الفرات')}`);
    expect(traders.body.data.map((t: { userId: string }) => t.userId)).toEqual([trader.id]);
    // Single-trader lookup (now an id search, not a 1000-row scan) still works.
    expect((await get(admin, `/admin/traders/${trader.id}`)).body.data.userId).toBe(trader.id);

    const supA = await registerUser(app, { firstName: 'ليلى', lastName: 'المشرفة' });
    const supB = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, supA.id, 'CONTENT');
    await assignSystemSupervisor(app, admin.accessToken, supB.id, 'CONTENT');
    const sups = await get(admin, `/admin/supervisors?search=${encodeURIComponent('ليلى')}`);
    expect(sups.body.data.map((s: { userId: string }) => s.userId)).toEqual([supA.id]);
  });

  it('support messages: by sender and by message text', async () => {
    const admin = await registerAdmin(app);
    const sender = await registerUser(app, { firstName: 'نور', lastName: 'المرسلة' });
    const other = await registerUser(app);
    const mine = await request(app)
      .post(`${API}/support-messages`)
      .set(bearer(sender.accessToken))
      .send({ body: 'لدي مشكلة في الدفع عند الشراء' });
    expect(mine.status).toBe(201);
    await request(app)
      .post(`${API}/support-messages`)
      .set(bearer(other.accessToken))
      .send({ body: 'سؤال عام' });

    expect(
      ids(await get(admin, `/admin/support-messages?search=${encodeURIComponent('نور')}`)),
    ).toEqual([mine.body.data.id]);
    expect(
      ids(await get(admin, `/admin/support-messages?search=${encodeURIComponent('الدفع')}`)),
    ).toEqual([mine.body.data.id]);
  });

  it('moderation queues: vet services, jobs, seekers, courses, publications', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const listing = await request(app)
      .post(`${API}/vet-services/listings`)
      .set(bearer(vet.accessToken))
      .send({
        title: 'تلقيح دواجن متخصص',
        description: 'خدمة تلقيح وتحصين الدواجن للوقاية من الأمراض وتحسين الإنتاج',
        serviceType: 'VACCINATION',
        animalType: 'POULTRY',
        governorate: 'نينوى',
        priceAmount: '150000',
        priceType: 'APPROXIMATE',
        locationMode: 'FIELD_VISIT',
      });
    expect(listing.status).toBe(201);
    expect(
      ids(await get(admin, `/admin/vet-service-listings?search=${encodeURIComponent('تلقيح')}`)),
    ).toEqual([listing.body.data.id]);
    expect(await get(admin, `/admin/vet-service-listings?search=nomatch`)).toHaveProperty(
      'body.data',
      [],
    );

    const poster = await registerUser(app);
    const offer = await createVetJobOffer(app, poster.accessToken, { title: 'جراح بيطري' });
    await createVetJobOffer(app, poster.accessToken, { title: 'مساعد مختبر' });
    expect(
      ids(await get(admin, `/admin/vet-job-offers?search=${encodeURIComponent('جراح')}`)),
    ).toEqual([offer.id]);

    const seeker = await createVetJobSeekerProfile(app, vet.accessToken, {
      specialty: 'طب الخيول',
    });
    expect(
      ids(await get(admin, `/admin/vet-job-seekers?search=${encodeURIComponent('الخيول')}`)),
    ).toEqual([seeker.id]);

    const manager = await registerApprovedVet(app);
    await assignSystemSupervisor(app, admin.accessToken, manager.id, 'VET_COURSES');
    const course = await createVetCourse(app, manager.accessToken, { title: 'أساسيات التغذية' });
    await createVetCourse(app, manager.accessToken, { title: 'جراحة متقدمة' });
    expect(
      ids(await get(admin, `/admin/vet-courses?search=${encodeURIComponent('التغذية')}`)),
    ).toEqual([course.id]);

    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken, { name: 'بسبوسة' });
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, {
      kind: 'ADOPTION',
    });
    const other = await createAnimal(app, owner.accessToken, { name: 'ريكس' });
    await createAnimalPublication(app, owner.accessToken, other.id, { kind: 'ADOPTION' });
    expect(
      ids(
        await get(
          admin,
          `/admin/animal-publications?kind=ADOPTION&search=${encodeURIComponent('بسبوسة')}`,
        ),
      ),
    ).toEqual([pub.id]);
    // Kind scope is preserved: the same term under LOST finds nothing.
    expect(
      ids(
        await get(
          admin,
          `/admin/animal-publications?kind=LOST&search=${encodeURIComponent('بسبوسة')}`,
        ),
      ),
    ).toEqual([]);
  });

  it('market offers, store orders, ad campaigns and the audit log', async () => {
    const admin = await registerAdmin(app);
    const trader = await registerApprovedTrader(app);
    const offer = await request(app)
      .post(`${API}/poultry-offers`)
      .set(bearer(trader.accessToken))
      .send({
        birdType: 'BROILER',
        quantity: 2000,
        pricingMethod: 'PER_KG',
        price: '3000',
        governorate: 'نينوى',
        phone: '+9647709998888',
      });
    expect(offer.status).toBe(201);
    expect(ids(await get(admin, '/admin/poultry-offers?search=7709998888'))).toEqual([
      offer.body.data.id,
    ]);
    // Seller trade name (trader_profiles.display_name) matches too.
    expect(
      ids(await get(admin, `/admin/poultry-offers?search=${encodeURIComponent('تاجر الاختبار')}`)),
    ).toEqual([offer.body.data.id]);

    const buyer = await registerUser(app);
    const [order] = await getTestDb()('pet_owner_store_orders')
      .insert({
        order_number: 'PS-2026-00042',
        user_id: buyer.id,
        payment_method: 'COD',
        subtotal_amount: 10,
        total_amount: 10,
        recipient_name: 'أم علي',
        recipient_phone: '07700000042',
        city: 'بغداد',
        address_line: 'الكرادة',
      })
      .returning('id');
    const orders = await get(admin, '/admin/pet-owner-store/orders?search=00042');
    expect(ids(orders)).toEqual([order.id]);
    expect(ids(await get(admin, '/admin/pet-owner-store/orders?search=nothing'))).toEqual([]);

    const ad = await createAdCampaign(app, admin.accessToken, {
      placement: 'HOME',
      type: 'BANNER',
      title: 'حملة الصيف',
    });
    await createAdCampaign(app, admin.accessToken, {
      placement: 'HOME',
      type: 'BANNER',
      title: 'Other',
    });
    expect(
      ids(await get(admin, `/admin/ads?placement=HOME&search=${encodeURIComponent('الصيف')}`)),
    ).toEqual([ad.body.data.id]);

    const audit = await get(admin, `/admin/audit-logs?search=${ad.body.data.id.slice(0, 8)}`);
    expect(audit.body.data.length).toBeGreaterThan(0);
    for (const e of audit.body.data as Array<{ entityId: string | null; id: string }>) {
      expect(`${e.entityId ?? ''}${e.id}`).toContain(ad.body.data.id.slice(0, 8));
    }
  });

  it('search stays permission-scoped and validated', async () => {
    const plain = await registerUser(app);
    const denied = await request(app)
      .get(`${API}/admin/organizations?search=x`)
      .set(bearer(plain.accessToken));
    expect(denied.status).toBe(403);

    const admin = await registerAdmin(app);
    const tooLong = await request(app)
      .get(`${API}/admin/supervisors?search=${'a'.repeat(200)}`)
      .set(bearer(admin.accessToken));
    expect(tooLong.status).toBe(422);
  });
});

describe('admin user profile links (§19 / §21)', () => {
  it('the deleted-accounts placeholder is "not found", never a profile', async () => {
    const admin = await registerAdmin(app);
    const res = await request(app)
      .get(`${API}/admin/users/00000000-0000-4000-8000-00000000d31e`)
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(404);
  });

  it('org list rows carry the real owner id; the owner profile needs user.read', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerApprovedVet(app);
    const org = await createOrganization(app, owner.accessToken, { type: 'CLINIC', name: 'عيادة' });
    const list = await get(admin, '/admin/organizations?type=CLINIC');
    const row = list.body.data.find((o: { id: string }) => o.id === org.id);
    expect(row.ownerUserId).toBe(owner.id);
    const detail = await get(admin, `/admin/organizations/${org.id}`);
    expect(detail.body.data.owner.id).toBe(owner.id);
    expect(detail.body.data.owner).not.toHaveProperty('passwordHash');

    expect((await get(admin, `/admin/users/${owner.id}`)).body.data.id).toBe(owner.id);
    // A CLINIC supervisor manages clinics but holds no user.read → no profile access.
    const sup = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, sup.id, 'CLINIC');
    const asSup = await request(app)
      .get(`${API}/admin/users/${owner.id}`)
      .set(bearer(sup.accessToken));
    expect(asSup.status).toBe(403);
  });
});
