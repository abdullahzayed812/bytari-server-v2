import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/app.js';
import { closeTestDb, ensureSchema, resetDb } from '../helpers/db.js';
import {
  applyToVetJobOffer,
  approveVetJobOffer,
  approveVetJobSeekerProfile,
  assignSystemSupervisor,
  bearer,
  createVetJobOffer,
  createVetJobSeekerProfile,
  registerAdmin,
  registerApprovedVet,
  registerUser,
} from '../helpers/factories.js';

const { app } = buildTestApp();

beforeAll(() => ensureSchema());
beforeEach(() => resetDb());
afterAll(() => closeTestDb());

const api = (p: string): string => `/api/v1/vet-jobs${p}`;
const adminApi = (p: string): string => `/api/v1/admin${p}`;

describe('Veterinarian Jobs — offers (any authenticated user, moderated)', () => {
  it('a plain user can post an offer; it starts PENDING and is not public until approved', async () => {
    const poster = await registerUser(app);
    const shopper = await registerUser(app);

    const created = await createVetJobOffer(app, poster.accessToken, { title: 'طبيب بيطري عام' });
    expect(created.id).toBeTruthy();

    const publicList = await request(app).get(api('/offers')).set(bearer(shopper.accessToken));
    expect(publicList.body.data).toHaveLength(0);

    const publicGet = await request(app)
      .get(api(`/offers/${created.id}`))
      .set(bearer(shopper.accessToken));
    expect(publicGet.status).toBe(404);

    const admin = await registerAdmin(app);
    const approve = await approveVetJobOffer(app, admin.accessToken, created.id);
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('APPROVED');

    const afterApproval = await request(app).get(api('/offers')).set(bearer(shopper.accessToken));
    expect(afterApproval.body.data).toHaveLength(1);
    expect(afterApproval.body.data[0].title).toBe('طبيب بيطري عام');
  });

  it('an ACTIVE VET_JOBS supervisor can moderate; the creator cannot approve their own offer', async () => {
    const admin = await registerAdmin(app);
    const sup = await registerUser(app);
    await assignSystemSupervisor(app, admin.accessToken, sup.id, 'VET_JOBS');
    const poster = await registerUser(app);

    const created = await createVetJobOffer(app, poster.accessToken);
    const selfApprove = await approveVetJobOffer(app, poster.accessToken, created.id);
    expect(selfApprove.status).toBe(403);

    const approve = await approveVetJobOffer(app, sup.accessToken, created.id);
    expect(approve.status).toBe(200);
  });

  it('rejects re-review of an already-decided offer (409) and requires a reason to reject', async () => {
    const admin = await registerAdmin(app);
    const poster = await registerUser(app);
    const created = await createVetJobOffer(app, poster.accessToken);

    const noReason = await request(app)
      .post(adminApi(`/vet-job-offers/${created.id}/reject`))
      .set(bearer(admin.accessToken))
      .send({});
    expect(noReason.status).toBe(422);

    const reject = await request(app)
      .post(adminApi(`/vet-job-offers/${created.id}/reject`))
      .set(bearer(admin.accessToken))
      .send({ reason: 'معلومات غير كافية' });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe('REJECTED');

    const again = await approveVetJobOffer(app, admin.accessToken, created.id);
    expect(again.status).toBe(409);
  });

  it('editing a rejected offer resets it to PENDING for re-review', async () => {
    const admin = await registerAdmin(app);
    const poster = await registerUser(app);
    const created = await createVetJobOffer(app, poster.accessToken);
    await request(app)
      .post(adminApi(`/vet-job-offers/${created.id}/reject`))
      .set(bearer(admin.accessToken))
      .send({ reason: 'x' });

    const edit = await request(app)
      .patch(api(`/offers/${created.id}`))
      .set(bearer(poster.accessToken))
      .send({ title: 'طبيب بيطري عام - محدث' });
    expect(edit.status).toBe(200);
    expect(edit.body.data.status).toBe('PENDING');
    expect(edit.body.data.rejectionReason).toBeNull();
  });

  it('the owner can close ("إلغاء الإعلان") their own offer; closed offers drop off the public list', async () => {
    const admin = await registerAdmin(app);
    const poster = await registerUser(app);
    const shopper = await registerUser(app);
    const created = await createVetJobOffer(app, poster.accessToken);
    await approveVetJobOffer(app, admin.accessToken, created.id);

    const close = await request(app)
      .post(api(`/offers/${created.id}/close`))
      .set(bearer(poster.accessToken));
    expect(close.status).toBe(200);

    const publicList = await request(app).get(api('/offers')).set(bearer(shopper.accessToken));
    expect(publicList.body.data).toHaveLength(0);

    const otherCloses = await request(app)
      .post(api(`/offers/${created.id}/close`))
      .set(bearer(shopper.accessToken));
    expect(otherCloses.status).toBe(403);
  });
});

describe('Veterinarian Jobs — job-seeker profiles ("باحثون عن عمل")', () => {
  it('only an approved veterinarian may create a profile; it is moderated the same way', async () => {
    const plainUser = await registerUser(app);
    const denied = await request(app)
      .post(api('/seekers'))
      .set(bearer(plainUser.accessToken))
      .send({ specialty: 'طب عام', governorate: 'بغداد', phone: '07701234567' });
    expect(denied.status).toBe(403);

    const vet = await registerApprovedVet(app);
    const created = await createVetJobSeekerProfile(app, vet.accessToken);
    expect(created.id).toBeTruthy();

    const otherUser = await registerUser(app);
    const beforeApproval = await request(app).get(api('/seekers')).set(bearer(otherUser.accessToken));
    expect(beforeApproval.body.data).toHaveLength(0);

    const admin = await registerAdmin(app);
    const approve = await approveVetJobSeekerProfile(app, admin.accessToken, created.id);
    expect(approve.status).toBe(200);

    const afterApproval = await request(app).get(api('/seekers')).set(bearer(otherUser.accessToken));
    expect(afterApproval.body.data).toHaveLength(1);
  });

  it('a veterinarian can only have one profile; a second create attempt 409s', async () => {
    const vet = await registerApprovedVet(app);
    await createVetJobSeekerProfile(app, vet.accessToken);
    const res = await request(app)
      .post(api('/seekers'))
      .set(bearer(vet.accessToken))
      .send({ specialty: 'طب عام', governorate: 'بغداد', phone: '07701234567' });
    expect(res.status).toBe(409);
  });

  it('"تواصل مع الطبيب" opens a direct chat with an approved job-seeker', async () => {
    const vet = await registerApprovedVet(app);
    const profile = await createVetJobSeekerProfile(app, vet.accessToken);
    const admin = await registerAdmin(app);
    await approveVetJobSeekerProfile(app, admin.accessToken, profile.id);

    const employer = await registerUser(app);
    const res = await request(app)
      .post(api(`/seekers/${profile.id}/conversation`))
      .set(bearer(employer.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.conversationId).toBeTruthy();

    // idempotent — same conversation on a second call
    const res2 = await request(app)
      .post(api(`/seekers/${profile.id}/conversation`))
      .set(bearer(employer.accessToken));
    expect(res2.body.data.conversationId).toBe(res.body.data.conversationId);
  });
});

describe('Veterinarian Jobs — applications (veterinarian → offer)', () => {
  async function approvedOffer(posterToken: string) {
    const admin = await registerAdmin(app);
    const offer = await createVetJobOffer(app, posterToken);
    await approveVetJobOffer(app, admin.accessToken, offer.id);
    return offer;
  }

  it('a pet owner (non-veterinarian) cannot apply', async () => {
    const poster = await registerUser(app);
    const offer = await approvedOffer(poster.accessToken);
    const petOwner = await registerUser(app);

    const res = await applyToVetJobOffer(app, petOwner.accessToken, offer.id);
    expect(res.status).toBe(403);
  });

  it('an approved veterinarian can apply; cannot apply twice; cannot apply to their own offer', async () => {
    const poster = await registerApprovedVet(app);
    const offer = await approvedOffer(poster.accessToken);

    const selfApply = await applyToVetJobOffer(app, poster.accessToken, offer.id);
    expect(selfApply.status).toBe(403);

    const applicant = await registerApprovedVet(app);
    const apply = await applyToVetJobOffer(app, applicant.accessToken, offer.id);
    expect(apply.status).toBe(201);
    expect(apply.body.data.status).toBe('PENDING');

    const again = await applyToVetJobOffer(app, applicant.accessToken, offer.id);
    expect(again.status).toBe(409);
  });

  it('cannot apply to an offer that is not open (still PENDING moderation)', async () => {
    const poster = await registerUser(app);
    const offer = await createVetJobOffer(app, poster.accessToken); // not approved
    const applicant = await registerApprovedVet(app);
    const res = await applyToVetJobOffer(app, applicant.accessToken, offer.id);
    expect(res.status).toBe(409);
  });

  it('the poster accepts an application → a chat conversation is created; reject also works', async () => {
    const poster = await registerUser(app);
    const offer = await approvedOffer(poster.accessToken);
    const applicant = await registerApprovedVet(app);
    const apply = await applyToVetJobOffer(app, applicant.accessToken, offer.id);
    const applicationId = apply.body.data.id as string;

    const accept = await request(app)
      .post(api(`/applications/${applicationId}/accept`))
      .set(bearer(poster.accessToken));
    expect(accept.status).toBe(200);
    expect(accept.body.data.status).toBe('ACCEPTED');
    expect(accept.body.data.conversationId).toBeTruthy();

    // the resulting conversation is usable by both parties
    const conversationId = accept.body.data.conversationId as string;
    const convoAsApplicant = await request(app)
      .get(`/api/v1/conversations/${conversationId}`)
      .set(bearer(applicant.accessToken));
    expect(convoAsApplicant.status).toBe(200);

    const again = await request(app)
      .post(api(`/applications/${applicationId}/accept`))
      .set(bearer(poster.accessToken));
    expect(again.status).toBe(409);

    const applicant2 = await registerApprovedVet(app);
    const apply2 = await applyToVetJobOffer(app, applicant2.accessToken, offer.id);
    const reject = await request(app)
      .post(api(`/applications/${apply2.body.data.id}/reject`))
      .set(bearer(poster.accessToken));
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe('REJECTED');
  });

  it("applications are private to the poster and the applicant; My Applications / My Ads lists scope correctly", async () => {
    const poster = await registerUser(app);
    const offer = await approvedOffer(poster.accessToken);
    const applicant = await registerApprovedVet(app);
    const apply = await applyToVetJobOffer(app, applicant.accessToken, offer.id);
    const stranger = await registerUser(app);

    const strangerGet = await request(app)
      .get(api(`/applications/${apply.body.data.id}`))
      .set(bearer(stranger.accessToken));
    expect(strangerGet.status).toBe(404);

    const mine = await request(app).get(api('/applications/mine')).set(bearer(applicant.accessToken));
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].offer.id).toBe(offer.id);

    const received = await request(app)
      .get(api('/applications/received'))
      .set(bearer(poster.accessToken));
    expect(received.body.data).toHaveLength(1);

    const myOffers = await request(app).get(api('/offers/mine')).set(bearer(poster.accessToken));
    expect(myOffers.body.data).toHaveLength(1);
    expect(myOffers.body.data[0].applicationCount).toBe(1);
  });
});

describe('Veterinarian Jobs — admin oversight', () => {
  it('admin can list every application (read-only) via vet_job.read', async () => {
    const admin = await registerAdmin(app);
    const poster = await registerUser(app);
    const offerAdmin = await registerAdmin(app);
    const offer = await createVetJobOffer(app, poster.accessToken);
    await approveVetJobOffer(app, offerAdmin.accessToken, offer.id);
    const applicant = await registerApprovedVet(app);
    await applyToVetJobOffer(app, applicant.accessToken, offer.id);

    const list = await request(app)
      .get(adminApi('/vet-job-applications'))
      .set(bearer(admin.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const denied = await request(app)
      .get(adminApi('/vet-job-applications'))
      .set(bearer(poster.accessToken));
    expect(denied.status).toBe(403);
  });
});
