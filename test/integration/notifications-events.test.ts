import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { InMemoryObjectStorage } from '../../src/infra/storage/index.js';
import { StoragePrefix } from '../../src/infra/storage/keys.js';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, getTestDb, resetDb } from '../helpers/db.js';
import { FakePushProvider } from '../helpers/fake-push-provider.js';
import {
  applyToVetJobOffer,
  approveOrganization,
  approveVetCourse,
  approveVetJobOffer,
  bearer,
  createAnimal,
  createAnimalPublication,
  createOrganization,
  createVetCourse,
  createVetJobOffer,
  registerAdmin,
  registerApprovedVet,
  registerDevice,
  registerForVetCourse,
  registerUser,
  seedStorageObject,
} from '../helpers/factories.js';

/**
 * Event → notification coverage for the domain events wired after Phase 15
 * (veterinarian approval, organization review queue, publications, jobs,
 * course capacity / cancellation, subscription expiry). Each test drives the
 * REAL HTTP flow so the event is published by the owning service after its
 * transaction commits.
 */
const push = new FakePushProvider();
const storage = new InMemoryObjectStorage(null);
const { app, container } = buildTestApp({ pushProvider: push, objectStorage: storage });
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

beforeAll(() => ensureSchema());
beforeEach(async () => {
  await resetDb();
  push.reset();
  storage.clear();
});
afterAll(() => closeTestDb());

interface Row {
  id: string;
  type: string;
  data: Record<string, string>;
  entity_type: string | null;
  entity_id: string | null;
  source_event_key: string | null;
}

function rows(userId: string): Promise<Row[]> {
  return getTestDb()('notifications')
    .where({ recipient_user_id: userId })
    .orderBy('created_at', 'asc')
    .select('id', 'type', 'data', 'entity_type', 'entity_id', 'source_event_key');
}
async function types(userId: string): Promise<string[]> {
  return (await rows(userId)).map((r) => r.type);
}

async function applyAsVeterinarian(token: string): Promise<request.Response> {
  const { storageKey } = await seedStorageObject(
    storage,
    StoragePrefix.veterinarianDocuments,
    Buffer.alloc(100, 1),
    'application/pdf',
  );
  return request(app)
    .post('/api/v1/veterinarians/apply')
    .set(bearer(token))
    .send({
      documents: [
        { kind: 'LICENSE_OR_ID', storageKey, filename: 'license.pdf', mimeType: 'application/pdf' },
      ],
    });
}

describe('veterinarian approval notifications', () => {
  it('apply → admins get VETERINARIAN_APPLICATION_SUBMITTED; approve → the vet gets VETERINARIAN_APPROVED + a push carrying notificationId', async () => {
    const admin = await registerAdmin(app);
    const applicant = await registerUser(app);
    await registerDevice(app, applicant.accessToken, {
      token: 'fcm-token-applicant-000000000000',
      platform: 'android',
    });

    expect((await applyAsVeterinarian(applicant.accessToken)).status).toBe(201);
    await tick();
    const submitted = (await rows(admin.id)).find(
      (r) => r.type === 'VETERINARIAN_APPLICATION_SUBMITTED',
    );
    expect(submitted?.data.applicantUserId).toBe(applicant.id);
    // the applicant is never notified about their own submission
    expect(await types(applicant.id)).not.toContain('VETERINARIAN_APPLICATION_SUBMITTED');

    push.reset();
    const approve = await request(app)
      .post(`/api/v1/admin/veterinarians/${applicant.id}/approve`)
      .set(bearer(admin.accessToken));
    expect(approve.status).toBe(200);
    await tick();

    const vetRows = await rows(applicant.id);
    const approved = vetRows.find((r) => r.type === 'VETERINARIAN_APPROVED');
    expect(approved).toBeDefined();
    expect(approved?.entity_type).toBe('VETERINARIAN_APPLICATION');

    const sent = push.sent.find((m) => m.data?.type === 'VETERINARIAN_APPROVED');
    expect(sent).toBeDefined();
    expect(sent?.data?.notificationId).toBe(approved?.id);
    expect(sent?.tokens).toEqual(['fcm-token-applicant-000000000000']);
  });

  it('reject → the vet gets VETERINARIAN_REJECTED; the rejection reason is NOT in the push payload', async () => {
    const admin = await registerAdmin(app);
    const applicant = await registerUser(app);
    await registerDevice(app, applicant.accessToken, {
      token: 'fcm-token-rejected-00000000000',
      platform: 'android',
    });
    await applyAsVeterinarian(applicant.accessToken);
    await tick();
    push.reset();

    const reject = await request(app)
      .post(`/api/v1/admin/veterinarians/${applicant.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'licence number could not be verified' });
    expect(reject.status).toBe(200);
    await tick();

    expect(await types(applicant.id)).toContain('VETERINARIAN_REJECTED');
    const sent = push.sent.find((m) => m.data?.type === 'VETERINARIAN_REJECTED');
    expect(sent).toBeDefined();
    expect(JSON.stringify(sent)).not.toContain('licence number');
  });
});

describe('organization review notifications', () => {
  it('a PENDING organization → admins get ORGANIZATION_SUBMITTED; approval → the owner gets ORGANIZATION_APPROVED', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const org = await createOrganization(app, vet.accessToken, {
      type: 'CLINIC',
      name: 'Pending Clinic',
    });
    await tick();

    const submitted = (await rows(admin.id)).find((r) => r.type === 'ORGANIZATION_SUBMITTED');
    expect(submitted).toMatchObject({ entity_type: 'ORGANIZATION', entity_id: org.id });
    expect(submitted?.data.organizationType).toBe('CLINIC');

    await approveOrganization(app, admin.accessToken, org.id);
    await tick();
    expect(await types(vet.id)).toContain('ORGANIZATION_APPROVED');
  });
});

describe('animal publication moderation notifications', () => {
  it('a new publication → admins get PUBLICATION_SUBMITTED; approval → the creator gets PUBLICATION_APPROVED', async () => {
    const admin = await registerAdmin(app);
    const owner = await registerUser(app);
    const animal = await createAnimal(app, owner.accessToken, {});
    const pub = await createAnimalPublication(app, owner.accessToken, animal.id, {
      kind: 'ADOPTION',
    });
    await tick();

    const submitted = (await rows(admin.id)).find((r) => r.type === 'PUBLICATION_SUBMITTED');
    expect(submitted?.data).toMatchObject({ publicationId: pub.id, kind: 'ADOPTION' });

    const approve = await request(app)
      .post(`/api/v1/admin/animal-publications/${pub.id}/approve`)
      .set(bearer(admin.accessToken));
    expect(approve.status).toBe(200);
    await tick();
    const approved = (await rows(owner.id)).find((r) => r.type === 'PUBLICATION_APPROVED');
    expect(approved?.data).toMatchObject({ publicationId: pub.id, kind: 'ADOPTION' });
  });
});

describe('veterinary jobs notifications', () => {
  it('offer submitted → admins; approved → poster; application → poster; accepted → applicant (with conversationId)', async () => {
    const admin = await registerAdmin(app);
    const poster = await registerApprovedVet(app);
    const applicant = await registerApprovedVet(app);

    const offer = await createVetJobOffer(app, poster.accessToken);
    await tick();
    expect(await types(admin.id)).toContain('VET_JOB_OFFER_SUBMITTED');

    expect((await approveVetJobOffer(app, admin.accessToken, offer.id)).status).toBe(200);
    await tick();
    expect(await types(poster.id)).toContain('VET_JOB_OFFER_APPROVED');

    const applied = await applyToVetJobOffer(app, applicant.accessToken, offer.id);
    expect(applied.status).toBe(201);
    await tick();
    expect(await types(poster.id)).toContain('VET_JOB_APPLICATION_RECEIVED');

    const accept = await request(app)
      .post(`/api/v1/vet-jobs/applications/${applied.body.data.id as string}/accept`)
      .set(bearer(poster.accessToken));
    expect(accept.status).toBe(200);
    await tick();
    const accepted = (await rows(applicant.id)).find(
      (r) => r.type === 'VET_JOB_APPLICATION_ACCEPTED',
    );
    expect(accepted?.data.conversationId).toBeTypeOf('string');
  });
});

describe('course capacity + cancellation notifications', () => {
  it('the organizer gets one RECEIVED per registration and CAPACITY_REACHED exactly once; cancelling notifies registrants', async () => {
    const admin = await registerAdmin(app);
    const organizer = await registerApprovedVet(app);
    const a = await registerApprovedVet(app);
    const b = await registerApprovedVet(app);

    const course = await createVetCourse(app, organizer.accessToken, { capacity: 2 });
    expect((await approveVetCourse(app, admin.accessToken, course.id)).status).toBe(200);

    expect((await registerForVetCourse(app, a.accessToken, course.id)).status).toBe(201);
    await tick();
    expect(await types(organizer.id)).not.toContain('VET_COURSE_CAPACITY_REACHED');

    expect((await registerForVetCourse(app, b.accessToken, course.id)).status).toBe(201);
    await tick();
    const orgTypes = await types(organizer.id);
    expect(orgTypes.filter((t) => t === 'VET_COURSE_REGISTRATION_RECEIVED')).toHaveLength(2);
    expect(orgTypes.filter((t) => t === 'VET_COURSE_CAPACITY_REACHED')).toHaveLength(1);
    expect(await types(a.id)).toContain('VET_COURSE_REGISTRATION_CONFIRMED');

    const cancel = await request(app)
      .post(`/api/v1/vet-courses/${course.id}/cancel`)
      .set(bearer(organizer.accessToken));
    expect(cancel.status).toBe(200);
    await tick();
    expect(await types(a.id)).toContain('VET_COURSE_CANCELLED');
    expect(await types(b.id)).toContain('VET_COURSE_CANCELLED');
    expect(await types(organizer.id)).not.toContain('VET_COURSE_CANCELLED');
  });
});

describe('subscription expiry sweep', () => {
  it('notifies the owner once per subscription period — re-running the sweep is a no-op', async () => {
    const admin = await registerAdmin(app);
    const vet = await registerApprovedVet(app);
    const clinic = await createOrganization(app, vet.accessToken, {
      type: 'CLINIC',
      name: 'Expiring',
    });
    await approveOrganization(app, admin.accessToken, clinic.id);
    const expired = await createOrganization(app, vet.accessToken, {
      type: 'CLINIC',
      name: 'Expired',
    });
    await approveOrganization(app, admin.accessToken, expired.id);

    const now = new Date('2031-03-10T12:00:00Z');
    await getTestDb()('clinic_details')
      .where({ organization_id: clinic.id })
      .update({ subscription_start_date: '2030-03-14', subscription_end_date: '2031-03-14' });
    await getTestDb()('clinic_details')
      .where({ organization_id: expired.id })
      .update({ subscription_start_date: '2030-03-08', subscription_end_date: '2031-03-08' });

    const first = await container.subscriptionExpiryNotifier.runOnce(now);
    expect(first).toEqual({ expiring: 1, expired: 1 });
    await container.subscriptionExpiryNotifier.runOnce(now);
    await tick();

    const vetRows = await rows(vet.id);
    const expiring = vetRows.filter((r) => r.type === 'SUBSCRIPTION_EXPIRING');
    const lapsed = vetRows.filter((r) => r.type === 'SUBSCRIPTION_EXPIRED');
    expect(expiring).toHaveLength(1);
    expect(lapsed).toHaveLength(1);
    expect(expiring[0]).toMatchObject({
      entity_id: clinic.id,
      source_event_key: `subscription.expiring:${clinic.id}:2031-03-14`,
    });
    expect(lapsed[0]?.entity_id).toBe(expired.id);
  });
});

describe('push retry', () => {
  it('a transient provider failure is retried (bounded) and the push is delivered', async () => {
    const admin = await registerAdmin(app);
    const applicant = await registerUser(app);
    await registerDevice(app, applicant.accessToken, {
      token: 'fcm-token-retry-0000000000000',
      platform: 'android',
    });
    await applyAsVeterinarian(applicant.accessToken);
    await tick();
    push.reset();
    push.failNextWith(new Error('FCM 503'));

    await request(app)
      .post(`/api/v1/admin/veterinarians/${applicant.id}/approve`)
      .set(bearer(admin.accessToken));
    await tick();

    expect(push.sent.filter((m) => m.data?.type === 'VETERINARIAN_APPROVED')).toHaveLength(1);
  });
});
