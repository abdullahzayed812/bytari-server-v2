import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { FakePushProvider } from '../helpers/fake-push-provider.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import {
  approveOrganization,
  bearer,
  createOrganization,
  extractVerificationCode,
  registerAdmin,
  registerApprovedVet,
  registerDevice,
  registerUser,
  verifyEmail,
} from '../helpers/factories.js';

/**
 * Admin-managed video links on acceptance notifications: the admin sets one
 * URL per key (`/admin/notifications/video-links`), the policy stamps
 * `data.videoLinkKey` on the notification, and reads resolve the CURRENT URL
 * into `data.videoUrl`.
 */
const push = new FakePushProvider();
const { app } = buildTestApp({ pushProvider: push });
const VIDEO_MESSAGE = 'لقد أعددنا فيديو توضيحي لك، يمكنك الاطلاع عليه.';
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  push.reset();
});
afterAll(() => closeTestDb());

async function setLink(token: string, key: string, url: string): Promise<request.Response> {
  return request(app)
    .put(`/api/v1/admin/notifications/video-links/${key}`)
    .set(bearer(token))
    .send({ url });
}

/**
 * A pet owner registered through the real two-step flow, WITHOUT the shared
 * factory (which removes the registration welcome to keep other tests' inbox
 * counts stable).
 */
async function registerPetOwnerKeepingWelcome(): Promise<{ accessToken: string }> {
  const email = `welcome-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const reg = await request(app).post('/api/v1/auth/register').send({
    email,
    password: 'correct-horse-battery-staple',
    firstName: 'Pet',
    lastName: 'Owner',
    phone: '+9647700000000',
  });
  expect(reg.status).toBe(201);
  const verified = await verifyEmail(app, email, extractVerificationCode(app, email));
  expect(verified.status).toBe(200);
  return { accessToken: verified.body.data.tokens.accessToken as string };
}

async function inbox(
  token: string,
): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
  const res = await request(app).get('/api/v1/notifications').set(bearer(token));
  expect(res.status).toBe(200);
  return res.body.data;
}

describe('admin video-link management', () => {
  it('lists every key (null when unset), sets, replaces and removes a link — audited', async () => {
    const admin = await registerAdmin(app);

    const empty = await request(app)
      .get('/api/v1/admin/notifications/video-links')
      .set(bearer(admin.accessToken));
    expect(empty.status).toBe(200);
    expect(empty.body.data.map((l: { key: string }) => l.key)).toEqual([
      'PET_OWNER_REGISTERED',
      'VETERINARIAN_APPROVED',
      'CLINIC_APPROVED',
      'VETERINARY_OFFICE_APPROVED',
      'POULTRY_FARM_APPROVED',
      'SHEEP_FARM_APPROVED',
      'CATTLE_FARM_APPROVED',
    ]);
    expect(empty.body.data.every((l: { url: unknown }) => l.url === null)).toBe(true);

    expect((await setLink(admin.accessToken, 'CLINIC_APPROVED', 'https://youtu.be/a')).status).toBe(
      200,
    );
    const replaced = await setLink(admin.accessToken, 'CLINIC_APPROVED', 'https://youtu.be/b');
    expect(replaced.body.data).toMatchObject({ key: 'CLINIC_APPROVED', url: 'https://youtu.be/b' });

    const del = await request(app)
      .delete('/api/v1/admin/notifications/video-links/CLINIC_APPROVED')
      .set(bearer(admin.accessToken));
    expect(del.status).toBe(204);
    const after = await request(app)
      .get('/api/v1/admin/notifications/video-links')
      .set(bearer(admin.accessToken));
    expect(
      after.body.data.find((l: { key: string }) => l.key === 'CLINIC_APPROVED').url,
    ).toBeNull();

    const audits = await getTestDb()('audit_logs')
      .whereIn('action', ['NOTIFICATION_VIDEO_LINK_UPDATED', 'NOTIFICATION_VIDEO_LINK_REMOVED'])
      .select('action');
    expect(audits).toHaveLength(3);
  });

  it('rejects non-admins, unknown keys and non-http(s) URLs', async () => {
    const admin = await registerAdmin(app);
    const user = await registerUser(app);

    expect((await setLink(user.accessToken, 'CLINIC_APPROVED', 'https://x.test')).status).toBe(403);
    expect(
      (
        await request(app)
          .get('/api/v1/admin/notifications/video-links')
          .set(bearer(user.accessToken))
      ).status,
    ).toBe(403);
    expect((await setLink(admin.accessToken, 'NOPE', 'https://x.test')).status).toBe(422);
    expect(
      (await setLink(admin.accessToken, 'CLINIC_APPROVED', 'javascript:alert(1)')).status,
    ).toBe(422);
  });
});

describe('video link on the receiver’s notification', () => {
  it('a pet owner’s registration welcome shows the current link (added, changed, removed after delivery)', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerPetOwnerKeepingWelcome();
    await tick();

    // Delivered before any link exists → no videoUrl, but the key is stamped.
    let [welcome] = (await inbox(owner.accessToken)).filter(
      (n) => n.type === 'PET_OWNER_REGISTRATION_COMPLETED',
    );
    expect(welcome?.data.videoLinkKey).toBe('PET_OWNER_REGISTERED');
    expect(welcome?.data.videoUrl).toBeUndefined();

    await setLink(admin.accessToken, 'PET_OWNER_REGISTERED', 'https://youtu.be/welcome');
    [welcome] = (await inbox(owner.accessToken)).filter(
      (n) => n.type === 'PET_OWNER_REGISTRATION_COMPLETED',
    );
    expect(welcome?.data.videoUrl).toBe('https://youtu.be/welcome');
    expect(welcome?.data.videoMessage).toBe(VIDEO_MESSAGE);

    await setLink(admin.accessToken, 'PET_OWNER_REGISTERED', 'https://youtu.be/welcome-v2');
    await request(app)
      .delete('/api/v1/admin/notifications/video-links/VETERINARIAN_APPROVED')
      .set(bearer(admin.accessToken));
    [welcome] = (await inbox(owner.accessToken)).filter(
      (n) => n.type === 'PET_OWNER_REGISTRATION_COMPLETED',
    );
    expect(welcome?.data.videoUrl).toBe('https://youtu.be/welcome-v2');

    await request(app)
      .delete('/api/v1/admin/notifications/video-links/PET_OWNER_REGISTERED')
      .set(bearer(admin.accessToken));
    [welcome] = (await inbox(owner.accessToken)).filter(
      (n) => n.type === 'PET_OWNER_REGISTRATION_COMPLETED',
    );
    expect(welcome?.data.videoUrl).toBeUndefined();
  });

  it('organization approval picks the link for its type; other types’ links never leak', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    await setLink(admin.accessToken, 'CLINIC_APPROVED', 'https://youtu.be/clinic');
    await setLink(admin.accessToken, 'VETERINARY_OFFICE_APPROVED', 'https://youtu.be/office');

    await registerDevice(app, vet.accessToken, {
      token: 'fcm-token-video-clinic-0000000000',
      platform: 'android',
    });
    const clinic = await createOrganization(app, vet.accessToken, {
      type: 'CLINIC',
      name: 'Video Clinic',
    });
    push.reset();
    await approveOrganization(app, admin.accessToken, clinic.id);
    await tick();

    // The push body carries the "we prepared a video" sentence.
    const approvedPush = push.sent.find((p) => p.data?.type === 'ORGANIZATION_APPROVED');
    expect(approvedPush?.body).toContain(VIDEO_MESSAGE);

    const approved = (await inbox(vet.accessToken)).filter(
      (n) => n.type === 'ORGANIZATION_APPROVED',
    );
    expect(approved).toHaveLength(1);
    expect(approved[0]?.data).toMatchObject({
      videoLinkKey: 'CLINIC_APPROVED',
      videoUrl: 'https://youtu.be/clinic',
      videoMessage: VIDEO_MESSAGE,
    });

    // GET /notifications/:id resolves the same way.
    const [row] = await getTestDb()('notifications')
      .where({ recipient_user_id: vet.id, type: 'ORGANIZATION_APPROVED' })
      .select('id');
    const one = await request(app)
      .get(`/api/v1/notifications/${row.id}`)
      .set(bearer(vet.accessToken));
    expect(one.body.data.data.videoUrl).toBe('https://youtu.be/clinic');
    expect(one.body.data.data.videoMessage).toBe(VIDEO_MESSAGE);
    // The stored body stays plain — the sentence follows the link, not the row.
    expect(one.body.data.body).not.toContain(VIDEO_MESSAGE);
  });

  it('without a link the push body and the row carry no video sentence', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    await registerDevice(app, vet.accessToken, {
      token: 'fcm-token-video-none-00000000000',
      platform: 'android',
    });
    const office = await createOrganization(app, vet.accessToken, {
      type: 'VETERINARY_OFFICE',
      name: 'No Video Office',
    });
    push.reset();
    await approveOrganization(app, admin.accessToken, office.id);
    await tick();
    const approvedPush = push.sent.find((p) => p.data?.type === 'ORGANIZATION_APPROVED');
    expect(approvedPush).toBeDefined();
    expect(approvedPush?.body).not.toContain(VIDEO_MESSAGE);
    const [approved] = (await inbox(vet.accessToken)).filter(
      (n) => n.type === 'ORGANIZATION_APPROVED',
    );
    expect(approved?.data.videoMessage).toBeUndefined();
  });

  it('a sheep farm approval uses the sheep-farm link', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    await setLink(admin.accessToken, 'SHEEP_FARM_APPROVED', 'https://youtu.be/sheep');
    await setLink(admin.accessToken, 'POULTRY_FARM_APPROVED', 'https://youtu.be/poultry');

    const create = await request(app)
      .post('/api/v1/organizations/sheep-farms')
      .set(bearer(vet.accessToken))
      .send({
        termsAccepted: true,
        name: 'مزرعة الأغنام',
        location: 'نينوى - الموصل',
        governorate: 'نينوى',
        sheepProductionType: 'MEAT',
        capacity: 100,
        currentSheepCount: 20,
        contactPhone: '+9647701234567',
      });
    expect(create.status).toBe(201);
    await approveOrganization(app, admin.accessToken, create.body.data.id);
    await tick();

    const [approved] = (await inbox(vet.accessToken)).filter(
      (n) => n.type === 'ORGANIZATION_APPROVED',
    );
    expect(approved?.data).toMatchObject({
      videoLinkKey: 'SHEEP_FARM_APPROVED',
      videoUrl: 'https://youtu.be/sheep',
    });
  });
});
