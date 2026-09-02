import type { Express } from 'express';
import request from 'supertest';
import type { ObjectStorage } from '../../src/infra/storage/index.js';
import { getTestDb } from './db.js';

export interface RegisteredUser {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
}

let seq = 0;
export function uniqueEmail(prefix = 'user'): string {
  seq += 1;
  return `${prefix}.${Date.now()}.${seq}@test.bytari`;
}

export async function registerUser(
  app: Express,
  overrides: Partial<{ email: string; password: string; firstName: string; lastName: string }> = {},
): Promise<RegisteredUser> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? 'correct-horse-battery-staple';
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      email,
      password,
      firstName: overrides.firstName ?? 'Test',
      lastName: overrides.lastName ?? 'User',
    });
  if (res.status !== 201) {
    throw new Error(`registerUser failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    id: res.body.data.user.id as string,
    email,
    password,
    accessToken: res.body.data.tokens.accessToken as string,
    refreshToken: res.body.data.tokens.refreshToken as string,
  };
}

export async function loginUser(
  app: Express,
  email: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string; status: number; body: unknown }> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return {
    status: res.status,
    body: res.body,
    accessToken: res.body?.data?.tokens?.accessToken as string,
    refreshToken: res.body?.data?.tokens?.refreshToken as string,
  };
}

/** Grant a role by writing `user_roles` directly (bypasses admin-permission checks for test setup). */
export async function grantRole(userId: string, roleKey: string): Promise<void> {
  const db = getTestDb();
  const role = (await db('roles').where({ key: roleKey }).first()) as { id: string } | undefined;
  if (!role) throw new Error(`role ${roleKey} not seeded`);
  await db('user_roles')
    .insert({ user_id: userId, role_id: role.id, assigned_by: null })
    .onConflict(['user_id', 'role_id'])
    .ignore();
}

/** Register a user and promote them to ADMIN. */
export async function registerAdmin(app: Express): Promise<RegisteredUser> {
  const admin = await registerUser(app, { email: uniqueEmail('admin') });
  await grantRole(admin.id, 'ADMIN');
  // Re-login so the access token reflects the new role set.
  const relog = await loginUser(app, admin.email, admin.password);
  return { ...admin, accessToken: relog.accessToken, refreshToken: relog.refreshToken };
}

/** Register a user and promote them to MODERATOR (read-only identity oversight). */
export async function registerModerator(app: Express): Promise<RegisteredUser> {
  const mod = await registerUser(app, { email: uniqueEmail('mod') });
  await grantRole(mod.id, 'MODERATOR');
  const relog = await loginUser(app, mod.email, mod.password);
  return { ...mod, accessToken: relog.accessToken, refreshToken: relog.refreshToken };
}

/**
 * Register a user, grant the VETERINARIAN global role and set
 * `veterinarian_status = APPROVED` directly (bypasses the Phase 2 workflow).
 * `authenticate` re-reads roles + status per request, so no re-login is needed.
 */
export async function registerApprovedVet(app: Express): Promise<RegisteredUser> {
  const vet = await registerUser(app, { email: uniqueEmail('vet') });
  await grantRole(vet.id, 'VETERINARIAN');
  await getTestDb()('users').where({ id: vet.id }).update({ veterinarian_status: 'APPROVED' });
  return vet;
}

/** Register a user whose veterinarian application is PENDING (not approved). */
export async function registerPendingVet(app: Express): Promise<RegisteredUser> {
  const vet = await registerUser(app, { email: uniqueEmail('pvet') });
  await getTestDb()('users').where({ id: vet.id }).update({ veterinarian_status: 'PENDING' });
  return vet;
}

/** Register a user whose veterinarian application was REJECTED. */
export async function registerRejectedVet(app: Express): Promise<RegisteredUser> {
  const vet = await registerUser(app, { email: uniqueEmail('rvet') });
  await getTestDb()('users').where({ id: vet.id }).update({ veterinarian_status: 'REJECTED' });
  return vet;
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

// --- Phase 3: organizations ---------------------------------------

export interface TestOrganization {
  id: string;
  type: string;
  status: string;
  ownerUserId: string;
  details: { joinCode?: string };
}

export async function createOrganization(
  app: Express,
  ownerToken: string,
  input: { type: string; name?: string; description?: string },
): Promise<TestOrganization> {
  const res = await request(app)
    .post('/api/v1/organizations')
    .set(bearer(ownerToken))
    .send({ name: input.name ?? `Org ${Date.now()}`, ...input });
  if (res.status !== 201) {
    throw new Error(`createOrganization failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as TestOrganization;
}

export async function approveOrganization(
  app: Express,
  adminToken: string,
  organizationId: string,
): Promise<void> {
  const res = await request(app)
    .post(`/api/v1/admin/organizations/${organizationId}/approve`)
    .set(bearer(adminToken));
  if (res.status !== 200) {
    throw new Error(`approveOrganization failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

/** Create + admin-approve an organization in one step. */
export async function createActiveOrganization(
  app: Express,
  ownerToken: string,
  adminToken: string,
  input: { type: string; name?: string },
): Promise<TestOrganization> {
  const org = await createOrganization(app, ownerToken, input);
  await approveOrganization(app, adminToken, org.id);
  return { ...org, status: 'ACTIVE' };
}

export async function addOrganizationMember(
  app: Express,
  actorToken: string,
  organizationId: string,
  input: { userId: string; role: 'VETERINARIAN' | 'STAFF' },
): Promise<{ id: string; roleKey: string }> {
  const res = await request(app)
    .post(`/api/v1/organizations/${organizationId}/members`)
    .set(bearer(actorToken))
    .send(input);
  if (res.status !== 201) {
    throw new Error(`addOrganizationMember failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { id: string; roleKey: string };
}

// --- Phase 4: animals & ownership -------------------------------

export interface TestAnimal {
  id: string;
  name: string;
  species: string;
  status: string;
  createdBy: string;
  currentOwnerUserId: string | null;
}

/** Create an animal as `ownerToken`; that caller becomes the current owner. */
export async function createAnimal(
  app: Express,
  ownerToken: string,
  input: Partial<{
    name: string;
    species: string;
    breed: string;
    sex: string;
    dateOfBirth: string;
    notes: string;
  }> = {},
): Promise<TestAnimal> {
  seq += 1;
  const res = await request(app)
    .post('/api/v1/animals')
    .set(bearer(ownerToken))
    .send({
      name: input.name ?? `Rex ${Date.now()}.${seq}`,
      species: input.species ?? 'DOG',
      ...(input.breed !== undefined ? { breed: input.breed } : {}),
      ...(input.sex !== undefined ? { sex: input.sex } : {}),
      ...(input.dateOfBirth !== undefined ? { dateOfBirth: input.dateOfBirth } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });
  if (res.status !== 201) {
    throw new Error(`createAnimal failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as TestAnimal;
}

/** Transfer an animal's ownership from `ownerToken` to `toUserId`. */
export async function transferAnimal(
  app: Express,
  ownerToken: string,
  animalId: string,
  toUserId: string,
  reason?: string,
): Promise<unknown> {
  const res = await request(app)
    .post(`/api/v1/animals/${animalId}/ownership/transfer`)
    .set(bearer(ownerToken))
    .send({ toUserId, ...(reason !== undefined ? { reason } : {}) });
  if (res.status !== 200) {
    throw new Error(`transferAnimal failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

// --- Phase 5: veterinary care ----------------------------------

/** Assign `userId` as an organization SUPERVISOR with an explicit permission set. */
export async function assignOrganizationSupervisor(
  app: Express,
  actorToken: string,
  organizationId: string,
  input: { userId: string; permissions: string[] },
): Promise<{ id: string }> {
  const res = await request(app)
    .post(`/api/v1/organizations/${organizationId}/supervisors`)
    .set(bearer(actorToken))
    .send(input);
  if (res.status !== 201) {
    throw new Error(
      `assignOrganizationSupervisor failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data as { id: string };
}

/** Grant a clinic ACTIVE veterinary access to an animal. */
export async function grantVeterinaryAccess(
  app: Express,
  actorToken: string,
  organizationId: string,
  animalId: string,
): Promise<{ id: string }> {
  const res = await request(app)
    .post(`/api/v1/organizations/${organizationId}/animal-access`)
    .set(bearer(actorToken))
    .send({ animalId });
  if (res.status !== 201) {
    throw new Error(`grantVeterinaryAccess failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { id: string };
}

export interface TestMedicalRecord {
  id: string;
  animalId: string;
  organizationId: string;
  recordedByUserId: string | null;
  diagnosis: string | null;
}

/** Create a medical record for `animalId` via clinic `organizationId`. */
export async function createMedicalRecord(
  app: Express,
  actorToken: string,
  organizationId: string,
  animalId: string,
  body: Partial<{
    visitDate: string;
    reason: string;
    diagnosis: string;
    treatment: string;
    notes: string;
  }> = {},
): Promise<TestMedicalRecord> {
  const res = await request(app)
    .post(`/api/v1/organizations/${organizationId}/animals/${animalId}/medical-records`)
    .set(bearer(actorToken))
    .send({ diagnosis: body.diagnosis ?? 'Healthy', ...body });
  if (res.status !== 201) {
    throw new Error(`createMedicalRecord failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as TestMedicalRecord;
}

/** Create a vaccination for `animalId` via clinic `organizationId`. */
export async function createVaccination(
  app: Express,
  actorToken: string,
  organizationId: string,
  animalId: string,
  body: Partial<{
    vaccineName: string;
    administeredOn: string;
    nextDueOn: string;
    notes: string;
  }> = {},
): Promise<{ id: string; vaccineName: string; nextDueOn: string | null }> {
  const res = await request(app)
    .post(`/api/v1/organizations/${organizationId}/animals/${animalId}/vaccinations`)
    .set(bearer(actorToken))
    .send({
      vaccineName: body.vaccineName ?? 'Rabies',
      administeredOn: body.administeredOn ?? '2026-01-15',
      ...(body.nextDueOn !== undefined ? { nextDueOn: body.nextDueOn } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    });
  if (res.status !== 201) {
    throw new Error(`createVaccination failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { id: string; vaccineName: string; nextDueOn: string | null };
}

// --- Phase 6: farms & poultry -------------------------------

export interface TestFarm {
  id: string;
  joinCode: string;
  ownerUserId: string;
}

/** Create + admin-approve a FARM organization; returns its id and join code. */
export async function createFarm(
  app: Express,
  ownerToken: string,
  adminToken: string,
  input: { name?: string } = {},
): Promise<TestFarm> {
  const org = await createOrganization(app, ownerToken, {
    type: 'FARM',
    name: input.name ?? `Farm ${Date.now()}`,
  });
  await approveOrganization(app, adminToken, org.id);
  if (!org.details?.joinCode) {
    throw new Error(`createFarm: no joinCode in ${JSON.stringify(org)}`);
  }
  return { id: org.id, joinCode: org.details.joinCode, ownerUserId: org.ownerUserId };
}

/** A veterinarian joins a farm with its join code. Returns the join HTTP response. */
export async function joinFarm(
  app: Express,
  vetToken: string,
  joinCode: string,
): Promise<request.Response> {
  return request(app).post('/api/v1/organizations/join').set(bearer(vetToken)).send({ joinCode });
}

export interface TestPoultryFlock {
  id: string;
  organizationId: string;
  name: string;
  birdType: string;
  birdCount: number;
  status: string;
}

/** Register a poultry flock for a farm. */
export async function createPoultryFlock(
  app: Express,
  actorToken: string,
  organizationId: string,
  body: Partial<{
    name: string;
    birdType: string;
    birdCount: number;
    arrivalDate: string;
    notes: string;
  }> = {},
): Promise<TestPoultryFlock> {
  const res = await request(app)
    .post(`/api/v1/organizations/${organizationId}/poultry/flocks`)
    .set(bearer(actorToken))
    .send({
      name: body.name ?? `Batch ${Date.now()}`,
      birdType: body.birdType ?? 'CHICKEN',
      birdCount: body.birdCount ?? 5000,
      arrivalDate: body.arrivalDate ?? '2026-02-01',
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    });
  if (res.status !== 201) {
    throw new Error(`createPoultryFlock failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as TestPoultryFlock;
}

// --- Phase 7: animal lifecycle publications ------------------

/** Assign an ACTIVE system-supervisor domain to a user (admin action). */
export async function assignSystemSupervisor(
  app: Express,
  adminToken: string,
  userId: string,
  domain: 'ANIMAL' | 'CLINIC' | 'STORE' | 'CONTENT' | 'CONSULTATION' | 'INQUIRY' | 'ADVERTISEMENT',
): Promise<{ id: string }> {
  const res = await request(app)
    .post('/api/v1/admin/supervisors')
    .set(bearer(adminToken))
    .send({ userId, domain });
  if (res.status !== 201) {
    throw new Error(`assignSystemSupervisor failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { id: string };
}

/** Register a user and assign them the ANIMAL system-supervisor domain. */
export async function registerAnimalSupervisor(
  app: Express,
  adminToken: string,
): Promise<RegisteredUser> {
  const sup = await registerUser(app, { email: uniqueEmail('animalsup') });
  await assignSystemSupervisor(app, adminToken, sup.id, 'ANIMAL');
  return sup;
}

export interface TestPublication {
  id: string;
  animalId: string;
  kind: string;
  status: string;
  createdByUserId: string;
}

/** Owner publishes an animal as LOST / ADOPTION / MATING. */
/**
 * Create a Lost / Adoption / Mating publication. Each kind requires a
 * different field set (contact info always; LOST needs when/where; ADOPTION /
 * MATING need city + health/vaccination status) — sane defaults are filled in
 * for anything not explicitly overridden, so most call sites only need `kind`.
 */
export async function createAnimalPublication(
  app: Express,
  ownerToken: string,
  animalId: string,
  input: {
    kind: 'LOST' | 'ADOPTION' | 'MATING';
    note?: string;
    extraNotes?: string;
    contactName?: string;
    contactPhone?: string;
    city?: string;
    healthStatus?: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
    vaccinationStatus?: 'COMPLETE' | 'PARTIAL' | 'NONE';
    isSterilized?: boolean;
    lostDate?: string;
    lostTime?: string;
    lostGovernorate?: string;
    lostDistrict?: string;
    lostLocationDetail?: string;
    healthNotes?: string;
  },
): Promise<TestPublication> {
  const body: Record<string, unknown> = {
    kind: input.kind,
    note: input.note,
    contactName: input.contactName ?? 'Test Contact',
    contactPhone: input.contactPhone ?? '07701234567',
  };
  if (input.kind === 'LOST') {
    body.lostDate = input.lostDate ?? '2026-01-01';
    body.lostTime = input.lostTime;
    body.lostGovernorate = input.lostGovernorate ?? 'Baghdad';
    body.lostDistrict = input.lostDistrict ?? 'Karrada';
    body.lostLocationDetail = input.lostLocationDetail;
    body.healthNotes = input.healthNotes;
  } else {
    body.extraNotes = input.extraNotes;
    body.city = input.city ?? 'Baghdad';
    body.healthStatus = input.healthStatus ?? 'GOOD';
    body.vaccinationStatus = input.vaccinationStatus ?? 'COMPLETE';
    if (input.kind === 'ADOPTION') {
      body.isSterilized = input.isSterilized ?? false;
      body.note = body.note ?? 'Friendly and playful, looking for a loving home.';
    }
  }

  const res = await request(app)
    .post(`/api/v1/animals/${animalId}/publications`)
    .set(bearer(ownerToken))
    .send(body);
  if (res.status !== 201) {
    throw new Error(`createAnimalPublication failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as TestPublication;
}

/** A viewer's interaction with an APPROVED publication ("طلب" / "ابلاغ"). Returns the raw response. */
export async function createPublicationInteraction(
  app: Express,
  actorToken: string,
  publicationId: string,
  input: { type: 'REQUEST' | 'SIGHTING'; message?: string },
): Promise<request.Response> {
  return request(app)
    .post(`/api/v1/animal-publications/${publicationId}/interactions`)
    .set(bearer(actorToken))
    .send(input);
}

/** Moderator approves a pending publication. Returns the HTTP response. */
export async function approvePublication(
  app: Express,
  moderatorToken: string,
  publicationId: string,
): Promise<request.Response> {
  return request(app)
    .post(`/api/v1/admin/animal-publications/${publicationId}/approve`)
    .set(bearer(moderatorToken));
}

// --- Phase 10: veterinary store products --------------------

export interface TestProduct {
  id: string;
  organizationId: string;
  name: string;
  productType: string;
  price: string | null;
  stockQuantity: number;
  status: string;
}

/** Add a product to a VETERINARY_STORE organization. */
export async function createProduct(
  app: Express,
  actorToken: string,
  organizationId: string,
  body: Partial<{
    name: string;
    description: string;
    productType: 'MEDICINE' | 'EQUIPMENT' | 'SUPPLY' | 'OTHER';
    price: string;
    stockQuantity: number;
  }> = {},
): Promise<TestProduct> {
  const res = await request(app)
    .post(`/api/v1/organizations/${organizationId}/products`)
    .set(bearer(actorToken))
    .send({
      name: body.name ?? `Amoxicillin ${Date.now()}`,
      productType: body.productType ?? 'MEDICINE',
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.price !== undefined ? { price: body.price } : {}),
      ...(body.stockQuantity !== undefined ? { stockQuantity: body.stockQuantity } : {}),
    });
  if (res.status !== 201) {
    throw new Error(`createProduct failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as TestProduct;
}

/** Adjust a product's stock by a signed delta. Returns the HTTP response. */
export async function adjustProductStock(
  app: Express,
  actorToken: string,
  organizationId: string,
  productId: string,
  delta: number,
  reason?: string,
): Promise<request.Response> {
  return request(app)
    .post(`/api/v1/organizations/${organizationId}/products/${productId}/stock`)
    .set(bearer(actorToken))
    .send({ delta, ...(reason !== undefined ? { reason } : {}) });
}

// --- Phase 12: chat & real-time messaging -------------------

export interface TestConversation {
  id: string;
  type: string;
  organizationId: string;
  counterpartUserId: string | null;
  viewerSide: string;
  unreadCount: number | null;
}

/** Start (or fetch) a conversation with an organization. Throws on 4xx/5xx. */
export async function startConversation(
  app: Express,
  actorToken: string,
  organizationId: string,
  targetUserId?: string,
): Promise<TestConversation> {
  const res = await request(app)
    .post(`/api/v1/organizations/${organizationId}/conversations`)
    .set(bearer(actorToken))
    .send(targetUserId !== undefined ? { targetUserId } : {});
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`startConversation failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data as TestConversation;
}

/** Send a chat message. Returns the raw HTTP response. */
export async function sendChatMessage(
  app: Express,
  actorToken: string,
  conversationId: string,
  body: string,
): Promise<request.Response> {
  return request(app)
    .post(`/api/v1/conversations/${conversationId}/messages`)
    .set(bearer(actorToken))
    .send({ body });
}

export async function listChatMessages(
  app: Express,
  actorToken: string,
  conversationId: string,
  query: Record<string, string | number> = {},
): Promise<request.Response> {
  return request(app)
    .get(`/api/v1/conversations/${conversationId}/messages`)
    .query(query)
    .set(bearer(actorToken));
}

export async function listConversations(
  app: Express,
  actorToken: string,
  query: Record<string, string | number> = {},
): Promise<request.Response> {
  return request(app).get('/api/v1/conversations').query(query).set(bearer(actorToken));
}

export async function markConversationRead(
  app: Express,
  actorToken: string,
  conversationId: string,
  messageId: string,
): Promise<request.Response> {
  return request(app)
    .post(`/api/v1/conversations/${conversationId}/read`)
    .set(bearer(actorToken))
    .send({ messageId });
}

export async function deleteChatMessage(
  app: Express,
  actorToken: string,
  messageId: string,
): Promise<request.Response> {
  return request(app).delete(`/api/v1/messages/${messageId}`).set(bearer(actorToken));
}

// --- Phase 13: consultations & inquiries --------------------

/** Register an approved vet and assign them the CONSULTATION or INQUIRY supervisor domain. */
export async function registerSupportSupervisor(
  app: Express,
  adminToken: string,
  domain: 'CONSULTATION' | 'INQUIRY',
): Promise<RegisteredUser> {
  const sup = await registerApprovedVet(app);
  await assignSystemSupervisor(app, adminToken, sup.id, domain);
  return sup;
}

export async function createConsultation(
  app: Express,
  actorToken: string,
  body: string,
  animalId?: string,
): Promise<request.Response> {
  return request(app)
    .post('/api/v1/consultations')
    .set(bearer(actorToken))
    .send({ body, ...(animalId !== undefined ? { animalId } : {}) });
}

export async function createInquiry(
  app: Express,
  actorToken: string,
  body: string,
): Promise<request.Response> {
  return request(app).post('/api/v1/inquiries').set(bearer(actorToken)).send({ body });
}

/** `base` is 'consultations' | 'inquiries'. */
export async function sendThreadMessage(
  app: Express,
  actorToken: string,
  base: 'consultations' | 'inquiries',
  threadId: string,
  body: string,
): Promise<request.Response> {
  return request(app)
    .post(`/api/v1/${base}/${threadId}/messages`)
    .set(bearer(actorToken))
    .send({ body });
}

export async function listThreadMessages(
  app: Express,
  actorToken: string,
  base: 'consultations' | 'inquiries',
  threadId: string,
  query: Record<string, string | number> = {},
): Promise<request.Response> {
  return request(app)
    .get(`/api/v1/${base}/${threadId}/messages`)
    .query(query)
    .set(bearer(actorToken));
}

export async function closeThread(
  app: Express,
  actorToken: string,
  base: 'consultations' | 'inquiries',
  threadId: string,
): Promise<request.Response> {
  return request(app).post(`/api/v1/${base}/${threadId}/close`).set(bearer(actorToken));
}

export async function blockThreadSender(
  app: Express,
  actorToken: string,
  base: 'consultations' | 'inquiries',
  threadId: string,
  block: boolean,
): Promise<request.Response> {
  return request(app)
    .post(`/api/v1/${base}/${threadId}/${block ? 'block' : 'unblock'}`)
    .set(bearer(actorToken));
}

export async function setAiSettings(
  app: Express,
  adminToken: string,
  patch: { consultationAiEnabled?: boolean; inquiryAiEnabled?: boolean },
): Promise<request.Response> {
  return request(app).patch('/api/v1/admin/ai-settings').set(bearer(adminToken)).send(patch);
}

// --- Phase 14: content management ---------------------------

/** Register an approved vet and assign them the CONTENT system-supervisor domain. */
export async function registerContentSupervisor(
  app: Express,
  adminToken: string,
): Promise<RegisteredUser> {
  const sup = await registerApprovedVet(app);
  await assignSystemSupervisor(app, adminToken, sup.id, 'CONTENT');
  return sup;
}

export interface TestContent {
  id: string;
  type: string;
  status: string;
  title: string;
}

export async function createContent(
  app: Express,
  actorToken: string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(app).post('/api/v1/admin/content').set(bearer(actorToken)).send(body);
}

export async function publishContent(
  app: Express,
  actorToken: string,
  contentId: string,
): Promise<request.Response> {
  return request(app).post(`/api/v1/admin/content/${contentId}/publish`).set(bearer(actorToken));
}

export async function archiveContent(
  app: Express,
  actorToken: string,
  contentId: string,
): Promise<request.Response> {
  return request(app).post(`/api/v1/admin/content/${contentId}/archive`).set(bearer(actorToken));
}

export async function createCategory(
  app: Express,
  actorToken: string,
  body: { slug: string; name: string; description?: string },
): Promise<request.Response> {
  return request(app).post('/api/v1/admin/content-categories').set(bearer(actorToken)).send(body);
}

/**
 * Full presigned upload cycle against the mocked storage: request a URL, "upload"
 * the bytes directly through the injected storage instance, then register.
 */
export async function uploadContentFile(
  app: Express,
  container: { objectStorage: ObjectStorage },
  actorToken: string,
  contentId: string,
  input: {
    kind: 'MAIN' | 'COVER' | 'ATTACHMENT';
    filename: string;
    mimeType: string;
    size: number;
  },
): Promise<request.Response> {
  const urlRes = await request(app)
    .post(`/api/v1/admin/content/${contentId}/files/upload-url`)
    .set(bearer(actorToken))
    .send(input);
  if (urlRes.status !== 201) return urlRes;
  const storageKey = urlRes.body.data.storageKey as string;
  await container.objectStorage.put(storageKey, Buffer.alloc(input.size, 1), {
    contentType: input.mimeType,
  });
  return request(app)
    .post(`/api/v1/admin/content/${contentId}/files`)
    .set(bearer(actorToken))
    .send({
      storageKey,
      kind: input.kind,
      filename: input.filename,
      mimeType: input.mimeType,
    });
}

// --- Mobile auth & registration: avatars / veterinarian documents ---

/**
 * Seed an object directly through the storage instance (not a real HTTP PUT),
 * mirroring the pattern `content.test.ts` uses for `uploadContentFile`. Returns
 * the storage key so the caller can pass it to a finalize / apply endpoint.
 */
export async function seedStorageObject(
  storage: ObjectStorage,
  prefix: string,
  buffer: Buffer,
  contentType: string,
): Promise<{ storageKey: string }> {
  seq += 1;
  const storageKey = `${prefix}/seed/${Date.now()}.${seq}`;
  await storage.put(storageKey, buffer, { contentType });
  return { storageKey };
}

// --- Phase 15: notifications & FCM -------------------------

export async function registerDevice(
  app: Express,
  actorToken: string,
  body: {
    token: string;
    platform: 'ios' | 'android' | 'web';
    deviceId?: string;
    appVersion?: string;
  },
): Promise<request.Response> {
  return request(app).post('/api/v1/notifications/devices').set(bearer(actorToken)).send(body);
}

export async function listDevices(app: Express, actorToken: string): Promise<request.Response> {
  return request(app).get('/api/v1/notifications/devices').set(bearer(actorToken));
}

export async function removeDevice(
  app: Express,
  actorToken: string,
  deviceId: string,
): Promise<request.Response> {
  return request(app).delete(`/api/v1/notifications/devices/${deviceId}`).set(bearer(actorToken));
}

export async function listNotifications(
  app: Express,
  actorToken: string,
  query: Record<string, string | number> = {},
): Promise<request.Response> {
  return request(app).get('/api/v1/notifications').query(query).set(bearer(actorToken));
}

export async function unreadCount(app: Express, actorToken: string): Promise<request.Response> {
  return request(app).get('/api/v1/notifications/unread-count').set(bearer(actorToken));
}

export async function markNotificationRead(
  app: Express,
  actorToken: string,
  notificationId: string,
): Promise<request.Response> {
  return request(app).post(`/api/v1/notifications/${notificationId}/read`).set(bearer(actorToken));
}

export async function markAllNotificationsRead(
  app: Express,
  actorToken: string,
): Promise<request.Response> {
  return request(app).post('/api/v1/notifications/read-all').set(bearer(actorToken));
}

export async function setPushPreference(
  app: Express,
  actorToken: string,
  pushEnabled: boolean,
): Promise<request.Response> {
  return request(app)
    .patch('/api/v1/notifications/preferences')
    .set(bearer(actorToken))
    .send({ pushEnabled });
}

export async function adminSendNotification(
  app: Express,
  adminToken: string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(app).post('/api/v1/admin/notifications').set(bearer(adminToken)).send(body);
}

// --- Advertisements: campaigns + ordered slides -----------------

/** Register a plain user and assign them the ADVERTISEMENT system-supervisor domain. */
export async function registerAdvertisementSupervisor(
  app: Express,
  adminToken: string,
): Promise<RegisteredUser> {
  const sup = await registerUser(app, { email: uniqueEmail('adsup') });
  await assignSystemSupervisor(app, adminToken, sup.id, 'ADVERTISEMENT');
  return sup;
}

export async function createAdCampaign(
  app: Express,
  actorToken: string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(app).post('/api/v1/admin/ads').set(bearer(actorToken)).send(body);
}

export async function addAdSlide(
  app: Express,
  actorToken: string,
  campaignId: string,
  body: Record<string, unknown> = {},
): Promise<request.Response> {
  return request(app)
    .post(`/api/v1/admin/ads/${campaignId}/slides`)
    .set(bearer(actorToken))
    .send(body);
}

/** Presigned upload cycle against the mocked storage, then register the image. */
export async function uploadAdSlideImage(
  app: Express,
  container: { objectStorage: ObjectStorage },
  actorToken: string,
  campaignId: string,
  slideId: string,
  input: { filename: string; mimeType: string; size: number } = {
    filename: 'banner.png',
    mimeType: 'image/png',
    size: 2048,
  },
): Promise<request.Response> {
  const urlRes = await request(app)
    .post(`/api/v1/admin/ads/${campaignId}/slides/${slideId}/image/upload-url`)
    .set(bearer(actorToken))
    .send(input);
  if (urlRes.status !== 201) return urlRes;
  const storageKey = urlRes.body.data.storageKey as string;
  await container.objectStorage.put(storageKey, Buffer.alloc(input.size, 1), {
    contentType: input.mimeType,
  });
  return request(app)
    .post(`/api/v1/admin/ads/${campaignId}/slides/${slideId}/image`)
    .set(bearer(actorToken))
    .send({ storageKey, mimeType: input.mimeType });
}

/** Full helper: create a campaign, add N imaged slides, activate it. */
export async function seedActiveAdCampaign(
  app: Express,
  container: { objectStorage: ObjectStorage },
  actorToken: string,
  input: { placement: string; type: 'BANNER' | 'CAROUSEL'; title?: string; slides?: number },
): Promise<{ campaignId: string; slideIds: string[] }> {
  const created = await createAdCampaign(app, actorToken, {
    placement: input.placement,
    type: input.type,
    title: input.title ?? `${input.placement} campaign`,
  });
  if (created.status !== 201) {
    throw new Error(
      `seedActiveAdCampaign create failed: ${created.status} ${JSON.stringify(created.body)}`,
    );
  }
  const campaignId = created.body.data.id as string;
  const n = input.slides ?? (input.type === 'BANNER' ? 1 : 2);
  const slideIds: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const slide = await addAdSlide(app, actorToken, campaignId, { title: `slide ${i + 1}` });
    if (slide.status !== 201) {
      throw new Error(
        `seedActiveAdCampaign slide failed: ${slide.status} ${JSON.stringify(slide.body)}`,
      );
    }
    const slideId = slide.body.data.id as string;
    slideIds.push(slideId);
    await uploadAdSlideImage(app, container, actorToken, campaignId, slideId);
  }
  await request(app).post(`/api/v1/admin/ads/${campaignId}/activate`).set(bearer(actorToken));
  return { campaignId, slideIds };
}

// --- Tips (structured care advice in the content module) --------

export async function createTip(
  app: Express,
  actorToken: string,
  body: Record<string, unknown> = {},
): Promise<request.Response> {
  return request(app)
    .post('/api/v1/admin/tips')
    .set(bearer(actorToken))
    .send({ title: 'Summer feeding for sheep', ...body });
}

export async function publishTip(
  app: Express,
  actorToken: string,
  tipId: string,
): Promise<request.Response> {
  return request(app).post(`/api/v1/admin/tips/${tipId}/publish`).set(bearer(actorToken));
}

/** Create + publish a tip in one step; returns its id. */
export async function seedPublishedTip(
  app: Express,
  actorToken: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const created = await createTip(app, actorToken, body);
  if (created.status !== 201) {
    throw new Error(
      `seedPublishedTip create failed: ${created.status} ${JSON.stringify(created.body)}`,
    );
  }
  const id = created.body.data.id as string;
  await publishTip(app, actorToken, id);
  return id;
}

/** Presigned cover upload cycle against the mocked storage, then register. */
export async function uploadTipCover(
  app: Express,
  container: { objectStorage: ObjectStorage },
  actorToken: string,
  tipId: string,
  input: { filename: string; mimeType: string; size: number } = {
    filename: 'cover.png',
    mimeType: 'image/png',
    size: 4096,
  },
): Promise<request.Response> {
  const urlRes = await request(app)
    .post(`/api/v1/admin/tips/${tipId}/cover/upload-url`)
    .set(bearer(actorToken))
    .send(input);
  if (urlRes.status !== 201) return urlRes;
  const storageKey = urlRes.body.data.storageKey as string;
  await container.objectStorage.put(storageKey, Buffer.alloc(input.size, 1), {
    contentType: input.mimeType,
  });
  return request(app)
    .post(`/api/v1/admin/tips/${tipId}/cover`)
    .set(bearer(actorToken))
    .send({ storageKey, mimeType: input.mimeType });
}
