import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { bearer, registerAdmin, registerApprovedVet, registerUser } from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const API = '/api/v1/organizations';

/** Terms addendum — the exact supplied clauses, accepted + stored on registration. */
describe('organization registration terms & conditions', () => {
  it('serves each applicable terms set verbatim (clause counts, first / last clauses)', async () => {
    const user = await registerUser(app);
    const expected: Record<string, { count: number; first: string; last: string }> = {
      CLINIC: {
        count: 26,
        first:
          'أن تكون العيادة البيطرية مرخصة أصولياً من الجهات الرسمية المختصة، ويجب تقديم الوثائق أو المستمسكات التي تثبت ذلك عند الطلب.',
        last: 'عند إرسال طلب التسجيل، يعتبر مقدم الطلب موافقاً على شروط وسياسات استخدام تطبيق بيطري | Baytari.',
      },
      VETERINARY_OFFICE: {
        count: 31,
        first:
          'يجب أن يكون المكتب البيطري مسجلاً أو مرخصاً أصولياً وفق التعليمات والقوانين المعمول بها في المنطقة التي يعمل بها.',
        last: 'عند إرسال طلب التسجيل، يعتبر صاحب المكتب موافقاً على شروط وسياسات تطبيق بيطري | Baytari.',
      },
      POULTRY_FARM: {
        count: 26,
        first:
          'يجب أن يكون مقدم طلب إضافة الحقل مالكاً للحقل أو مخولاً رسمياً بإدارته، ويتحمل مسؤولية صحة المعلومات المقدمة.',
        last: 'عند إرسال طلب التسجيل، يعتبر مقدم الطلب موافقاً على شروط وسياسات استخدام تطبيق بيطري | Baytari.',
      },
      SHEEP_FARM: {
        count: 27,
        first:
          'يجب أن يكون مقدم الطلب مالكاً للحقل أو مخولاً بإدارته، ويتحمل المسؤولية عن صحة البيانات المقدمة.',
        last: 'عند إرسال طلب التسجيل يعتبر مقدم الطلب موافقاً على شروط وسياسات تطبيق بيطري | Baytari.',
      },
      CATTLE_FARM: {
        count: 30,
        first: 'يجب أن يكون مقدم الطلب مالكاً للحقل أو مخولاً رسمياً بإدارته.',
        last: 'عند إرسال طلب التسجيل يعتبر مقدم الطلب موافقاً على شروط وسياسات استخدام تطبيق بيطري | Baytari.',
      },
    };
    for (const [key, e] of Object.entries(expected)) {
      const res = await request(app).get(`${API}/terms/${key}`).set(bearer(user.accessToken));
      expect(res.status).toBe(200);
      expect(res.body.data.termsKey).toBe(key);
      expect(res.body.data.clauses).toHaveLength(e.count);
      expect(res.body.data.clauses[0]).toBe(e.first);
      expect(res.body.data.clauses[e.count - 1]).toBe(e.last);
      expect(res.body.data.version).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(
      (await request(app).get(`${API}/terms/STORE`).set(bearer(user.accessToken))).status,
    ).toBe(422);
  });

  it('refuses a clinic / office / farm registration without accepting the terms', async () => {
    const vet = await registerApprovedVet(app);
    const user = await registerUser(app);
    for (const type of ['CLINIC', 'VETERINARY_OFFICE']) {
      const res = await request(app)
        .post(API)
        .set(bearer(vet.accessToken))
        .send({ type, name: 'بدون موافقة' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TERMS_NOT_ACCEPTED');
      const rejected = await request(app)
        .post(API)
        .set(bearer(vet.accessToken))
        .send({ type, name: 'رفض صريح', termsAccepted: false });
      expect(rejected.status).toBe(400);
    }
    const farmBody = {
      name: 'حقل',
      location: 'بغداد',
      governorate: 'بغداد',
    };
    const poultry = await request(app)
      .post(`${API}/farms`)
      .set(bearer(user.accessToken))
      .send({ ...farmBody, poultryProductionType: 'BROILER' });
    expect(poultry.body.error?.code).toBe('TERMS_NOT_ACCEPTED');
    const sheep = await request(app)
      .post(`${API}/sheep-farms`)
      .set(bearer(user.accessToken))
      .send({ ...farmBody, sheepProductionType: 'MEAT' });
    expect(sheep.body.error?.code).toBe('TERMS_NOT_ACCEPTED');
    const cattle = await request(app)
      .post(`${API}/cattle-farms`)
      .set(bearer(user.accessToken))
      .send({ ...farmBody, cattleProductionType: 'DAIRY' });
    expect(cattle.body.error?.code).toBe('TERMS_NOT_ACCEPTED');
    expect(await getTestDb()('organizations').count({ c: '*' }).first()).toEqual({ c: '0' });
  });

  it('a stale terms version is refused (409) so the user must review the current terms', async () => {
    const vet = await registerApprovedVet(app);
    const res = await request(app).post(API).set(bearer(vet.accessToken)).send({
      type: 'CLINIC',
      name: 'عيادة',
      termsAccepted: true,
      termsVersion: 'deadbeefdeadbeef',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TERMS_VERSION_OUTDATED');
  });

  it('stores the acceptance (who, which terms, version, when) and the admin sees it', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const owner = await registerUser(app);
    const terms = await request(app).get(`${API}/terms/CLINIC`).set(bearer(vet.accessToken));

    const clinic = await request(app).post(API).set(bearer(vet.accessToken)).send({
      type: 'CLINIC',
      name: 'عيادة الموافقة',
      termsAccepted: true,
      termsVersion: terms.body.data.version,
    });
    expect(clinic.status).toBe(201);
    const sheep = await request(app)
      .post(`${API}/sheep-farms`)
      .set(bearer(owner.accessToken))
      .send({
        name: 'حقل الأغنام',
        location: 'ديالى',
        governorate: 'ديالى',
        sheepProductionType: 'MEAT',
        termsAccepted: true,
      });
    expect(sheep.status).toBe(201);

    const rows = await getTestDb()('organization_terms_acceptances').orderBy('accepted_at');
    expect(rows.map((r: { terms_key: string }) => r.terms_key).sort()).toEqual([
      'CLINIC',
      'SHEEP_FARM',
    ]);
    expect(rows.every((r: { accepted_at: Date | null }) => r.accepted_at instanceof Date)).toBe(
      true,
    );

    const detail = await request(app)
      .get(`/api/v1/admin/organizations/${clinic.body.data.id}`)
      .set(bearer(admin.accessToken));
    expect(detail.body.data.termsAcceptances).toEqual([
      expect.objectContaining({
        termsKey: 'CLINIC',
        termsVersion: terms.body.data.version,
        acceptedByUserId: vet.id,
        isCurrentVersion: true,
      }),
    ]);
    expect(typeof detail.body.data.termsAcceptances[0].acceptedAt).toBe('string');
  });

  it('organization types without registration terms are unaffected', async () => {
    const vet = await registerApprovedVet(app);
    const res = await request(app)
      .post(API)
      .set(bearer(vet.accessToken))
      .send({ type: 'VETERINARY_STORE', name: 'مخزن' });
    expect(res.status).toBe(201);
  });
});
