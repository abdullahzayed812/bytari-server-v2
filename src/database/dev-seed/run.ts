/**
 * Development persona seed — orchestrator. LOCAL DEVELOPMENT ONLY.
 *
 * Builds the real application {@link createContainer} against the seed's Knex
 * connection and drives the ordinary application services (register / approve
 * veterinarian / create organization / add member / …) so every seeded record
 * respects the same business rules, audit logging and events as a request would.
 *
 * NOTHING here weakens authentication: personas get plain `users` rows with an
 * Argon2id hash of {@link DEV_PASSWORD} produced by the app's `PasswordService`,
 * and they authenticate through the unmodified `POST /api/v1/auth/login`.
 *
 * Idempotent: safe to run repeatedly. Every step is "find-or-create then
 * converge state" keyed on the deterministic persona / organization identifiers.
 *
 * Run with `npm run db:seed:dev` (see package.json).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { loadConfig, type AppConfig } from '../../config/index.js';
import { createLogger } from '../../shared/logger/index.js';
import { createContainer, type Container } from '../../container.js';
import { createKnex } from '../knex.js';
import { buildObjectKey, StoragePrefix } from '../../infra/storage/index.js';
import type { AuditContext } from '../../modules/audit/audit.types.js';
import type { VeterinarianStatus } from '../../modules/users/user.types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
  DEV_ANIMALS,
  DEV_MEMBERSHIPS,
  DEV_ORGANIZATION_LIST,
  DEV_ORGANIZATIONS,
  DEV_PASSWORD,
  DEV_PERSONA_LIST,
  DEV_PERSONAS,
  DEV_SUPERVISORS,
  type DevOrganization,
  type DevOrganizationKey,
  type DevPersona,
} from './personas.js';

export { DEV_PASSWORD } from './personas.js';

const SEED_CONTEXT: AuditContext = {
  userAgent: 'bytari-dev-seed',
  ip: null,
  requestId: 'dev-seed',
};

export interface DevSeedGateResult {
  allowed: boolean;
  reason: string;
}

/**
 * Decide whether the development seed is allowed to run. Never in production —
 * regardless of any flag. Automatic in development; opt-in elsewhere via
 * `ENABLE_DEV_SEEDS=true`.
 */
export function devSeedGate(config: AppConfig): DevSeedGateResult {
  if (config.isProduction) {
    return {
      allowed: false,
      reason: 'NODE_ENV=production — development personas are never seeded',
    };
  }
  if (config.devSeed.enabled) {
    return {
      allowed: true,
      reason: config.env === 'development' ? 'NODE_ENV=development' : 'ENABLE_DEV_SEEDS=true',
    };
  }
  return {
    allowed: false,
    reason: `NODE_ENV=${config.env} and ENABLE_DEV_SEEDS is not true`,
  };
}

export interface DevSeedResult {
  skipped: boolean;
  reason?: string;
  userIdsByKey: Record<string, string>;
  organizationIdsByKey: Record<string, string>;
  animalIdsByName: Record<string, string>;
}

export interface RunDevSeedDeps {
  config?: AppConfig;
  logger?: Logger;
}

export async function runDevSeed(knex: Knex, deps: RunDevSeedDeps = {}): Promise<DevSeedResult> {
  const config = deps.config ?? loadConfig();
  const logger = (deps.logger ?? createLogger(config)).child({ component: 'dev-seed' });

  const gate = devSeedGate(config);
  if (!gate.allowed) {
    logger.warn({ reason: gate.reason }, 'development seed skipped');
    return {
      skipped: true,
      reason: gate.reason,
      userIdsByKey: {},
      organizationIdsByKey: {},
      animalIdsByName: {},
    };
  }
  logger.info({ reason: gate.reason }, 'development seed starting');

  const container: Container = createContainer({ db: knex, config, logger });
  const { authService, userService, veterinarianService, organizationService } = container;
  const { membershipService, membershipRepository, organizationSupervisorService } = container;
  const { animalService, veterinaryAccessService, medicalRecordService, vaccinationService } =
    container;
  const { poultryFlockService, productService, contentService, passwordService } = container;
  const { poultryDailyRecordService, farmExpenseService, poultryHealthEventService } = container;
  const { farmAppointmentService, poultryCaseService, farmProfileService } = container;
  const { tipService, newsService } = container;
  const { advertisementService, objectStorage } = container;

  /** Non-null lookup into one of the id maps built below. */
  const must = (map: Record<string, string>, key: string, kind: string): string => {
    const value = map[key];
    if (!value) throw new Error(`dev-seed: no ${kind} resolved for key "${key}"`);
    return value;
  };

  // --- role helper --------------------------------------------------
  async function ensureRole(
    userId: string,
    roleKey: string,
    assignedBy: string | null,
  ): Promise<void> {
    const role = await knex('roles').where({ key: roleKey }).first();
    if (!role) {
      throw new Error(
        `dev-seed: role "${roleKey}" is not seeded. Run \`npm run db:seed\` before the dev seed.`,
      );
    }
    await container.roleRepository.assignRole(userId, role.id, assignedBy);
  }

  // --- ADMIN (same mechanism as 0020_bootstrap_admin: no acting user yet) ---
  async function ensureAdmin(): Promise<string> {
    const p = DEV_PERSONAS.admin;
    const passwordHash = await passwordService.hash(DEV_PASSWORD);
    const existing: { id: string } | undefined = await knex('users')
      .where({ email: p.email })
      .first();

    let userId: string;
    if (existing) {
      await knex('users').where({ id: existing.id }).update({
        password_hash: passwordHash,
        status: 'ACTIVE',
        first_name: p.firstName,
        last_name: p.lastName,
        updated_at: knex.fn.now(),
      });
      userId = existing.id;
    } else {
      const inserted: Array<{ id: string }> = await knex('users')
        .insert({
          email: p.email,
          password_hash: passwordHash,
          first_name: p.firstName,
          last_name: p.lastName,
          status: 'ACTIVE',
          veterinarian_status: 'NOT_APPLIED',
        })
        .returning('id');
      const row = inserted[0];
      if (!row) throw new Error('dev-seed: failed to insert admin persona');
      userId = row.id;
    }

    await ensureRole(userId, 'ADMIN', null);
    await ensureRole(userId, 'PET_OWNER', null);
    return userId;
  }

  const adminId = await ensureAdmin();
  const adminActor = { actorUserId: adminId, context: SEED_CONTEXT };

  // --- non-admin persona users -----------------------------------
  async function ensureUser(p: DevPersona): Promise<string> {
    const existing: { id: string } | undefined = await knex('users')
      .where({ email: p.email })
      .first();

    let userId: string;
    if (existing) {
      userId = existing.id;
      // Always refresh the password + name so the documented credentials work.
      await knex('users')
        .where({ id: userId })
        .update({
          password_hash: await passwordService.hash(DEV_PASSWORD),
          status: 'ACTIVE',
          first_name: p.firstName,
          last_name: p.lastName,
          updated_at: knex.fn.now(),
        });
    } else {
      const created = await authService.adminCreateUser(
        {
          email: p.email,
          password: DEV_PASSWORD,
          firstName: p.firstName,
          lastName: p.lastName,
          roles: ['PET_OWNER', ...p.roles],
        },
        adminActor,
      );
      userId = created.user.id;
    }

    for (const roleKey of ['PET_OWNER', ...p.roles]) {
      await ensureRole(userId, roleKey, adminId);
    }
    return userId;
  }

  // --- veterinarian workflow convergence ------------------------
  async function ensureVetState(
    userId: string,
    target: VeterinarianStatus | 'NONE',
  ): Promise<void> {
    if (target === 'NONE') return;
    const current = (await userService.getById(userId)).veterinarianStatus;

    if (target === 'APPROVED') {
      if (current === 'APPROVED') return;
      if (current !== 'PENDING') {
        await veterinarianService.apply(
          userId,
          { note: 'Development seed persona.', subType: 'VETERINARIAN', documents: [] },
          SEED_CONTEXT,
        );
      }
      await veterinarianService.approve(userId, adminActor);
      return;
    }

    if (target === 'PENDING') {
      if (current === 'PENDING') return;
      if (current === 'APPROVED') {
        logger.warn({ userId }, 'persona already APPROVED — leaving as-is (cannot downgrade)');
        return;
      }
      await veterinarianService.apply(
        userId,
        { note: 'Development seed persona.', subType: 'VETERINARIAN', documents: [] },
        SEED_CONTEXT,
      );
      return;
    }

    // target === 'REJECTED'
    if (current === 'REJECTED') return;
    if (current === 'APPROVED') {
      logger.warn({ userId }, 'persona already APPROVED — leaving as-is (cannot downgrade)');
      return;
    }
    if (current !== 'PENDING') {
      await veterinarianService.apply(
        userId,
        { note: 'Development seed persona.', subType: 'VETERINARIAN', documents: [] },
        SEED_CONTEXT,
      );
    }
    await veterinarianService.reject(userId, 'Development seed: rejected persona.', adminActor);
  }

  const userIdsByKey: Record<string, string> = { admin: adminId };
  for (const persona of DEV_PERSONA_LIST) {
    if (persona.key === 'admin') continue;
    const userId = await ensureUser(persona);
    userIdsByKey[persona.key] = userId;
    await ensureVetState(userId, persona.vet);
  }

  // --- organizations -------------------------------------------
  async function ensureOrganization(def: DevOrganization): Promise<string> {
    const ownerId = userIdsByKey[def.ownerKey];
    if (!ownerId) throw new Error(`dev-seed: owner persona "${def.ownerKey}" missing`);

    let row: { id: string; status: string } | undefined = await knex('organizations')
      .where({ owner_user_id: ownerId, type: def.type })
      .first();

    if (!row) {
      const created = await organizationService.create(
        { type: def.type, name: def.name, description: def.description },
        { actorUserId: ownerId, context: SEED_CONTEXT },
      );
      row = { id: created.id, status: created.status };
    }

    const status = (await organizationService.getById(row.id)).status;
    if (status === 'PENDING') {
      await organizationService.approve(row.id, adminActor);
    } else if (status !== 'ACTIVE') {
      await organizationService.changeStatus(row.id, 'activate', adminActor);
    }
    return row.id;
  }

  const organizationIdsByKey: Record<string, string> = {};
  for (const def of DEV_ORGANIZATION_LIST) {
    organizationIdsByKey[def.key] = await ensureOrganization(def);
  }

  // Directory profile (address/coordinates/phone) for the profile-bearing
  // types, so the Pet Owner directory screens + "nearest" sort have real data
  // to show in development instead of empty fields.
  const DEV_PROFILES: Partial<
    Record<
      DevOrganizationKey,
      { address: string; latitude: number; longitude: number; phone: string }
    >
  > = {
    clinic: {
      address: 'Baghdad — Karrada, 14 Ramadan Street',
      latitude: 33.3152,
      longitude: 44.3661,
      phone: '+964 770 123 4567',
    },
    office: {
      address: 'Baghdad — Mansour District',
      latitude: 33.3406,
      longitude: 44.3244,
      phone: '+964 780 234 5678',
    },
    store: {
      address: 'Basra — Al-Ashar',
      latitude: 30.5085,
      longitude: 47.7835,
      phone: '+964 750 345 6789',
    },
  };
  for (const [key, profile] of Object.entries(DEV_PROFILES)) {
    const orgId = organizationIdsByKey[key];
    if (!orgId || !profile) continue;
    await organizationService.updateProfile(orgId, profile, adminActor);
  }

  // --- memberships (VETERINARIAN / STAFF) ----------------------
  for (const m of DEV_MEMBERSHIPS) {
    const orgId = must(organizationIdsByKey, m.orgKey, 'organization');
    const userId = must(userIdsByKey, m.personaKey, 'user');
    const ownerKey = DEV_ORGANIZATIONS[m.orgKey].ownerKey;
    const actor = { actorUserId: must(userIdsByKey, ownerKey, 'user'), context: SEED_CONTEXT };

    const existing = await membershipRepository.findByUserAndOrg(userId, orgId);
    if (existing && existing.status === 'ACTIVE') {
      if (existing.roleKey !== m.role && existing.roleKey !== 'OWNER') {
        await membershipService.updateMember(orgId, existing.id, { roleKey: m.role }, actor);
      }
      continue;
    }
    await membershipService.addMember(orgId, { userId, roleKey: m.role }, actor);
  }

  // --- organization supervisors (LIMITED permission set) -------
  for (const s of DEV_SUPERVISORS) {
    const orgId = must(organizationIdsByKey, s.orgKey, 'organization');
    const userId = must(userIdsByKey, s.personaKey, 'user');
    const ownerKey = DEV_ORGANIZATIONS[s.orgKey].ownerKey;
    const actor = { actorUserId: must(userIdsByKey, ownerKey, 'user'), context: SEED_CONTEXT };

    const existing = await membershipRepository.findByUserAndOrg(userId, orgId);
    if (existing && existing.status === 'ACTIVE' && existing.roleKey === 'SUPERVISOR') {
      await organizationSupervisorService.updatePermissions(
        orgId,
        existing.id,
        s.permissions,
        actor,
      );
    } else {
      await organizationSupervisorService.assign(
        orgId,
        { userId, permissions: s.permissions },
        actor,
      );
    }
  }

  // --- pet owner's animals -----------------------------------
  const animalIdsByName: Record<string, string> = {};
  for (const a of DEV_ANIMALS) {
    const ownerId = must(userIdsByKey, a.ownerKey, 'user');
    const existing: { id: string } | undefined = await knex('animals')
      .where({ created_by: ownerId, name: a.name })
      .first();
    if (existing) {
      animalIdsByName[a.name] = existing.id;
      continue;
    }
    const created = await animalService.create(
      {
        name: a.name,
        species: a.species,
        sex: a.sex,
        breed: a.breed,
        dateOfBirth: a.dateOfBirth,
        notes: a.notes,
      },
      { actorUserId: ownerId, context: SEED_CONTEXT },
    );
    animalIdsByName[a.name] = created.id;
  }

  // --- domain sample data (small, high-value, idempotent) -----
  await seedClinicCareForMax();
  await seedFarmPoultry();
  await seedStoreProducts();
  await seedWelcomeArticle();
  await seedAdvertisements();
  await seedTips();
  await seedNews();

  logger.info(
    {
      users: Object.keys(userIdsByKey).length,
      organizations: Object.keys(organizationIdsByKey).length,
      animals: Object.keys(animalIdsByName).length,
    },
    'development seed complete',
  );

  return {
    skipped: false,
    userIdsByKey,
    organizationIdsByKey,
    animalIdsByName,
  };

  // ---------------------------------------------------------------
  // domain sample-data helpers (closures over the ids built above)
  // ---------------------------------------------------------------

  async function seedClinicCareForMax(): Promise<void> {
    const clinicId = organizationIdsByKey.clinic;
    const maxId = animalIdsByName.Max;
    if (!clinicId || !maxId) return;

    const clinicOwnerActor = {
      actorUserId: must(userIdsByKey, 'clinicOwner', 'user'),
      context: SEED_CONTEXT,
    };
    const clinicRef = { id: clinicId, type: 'CLINIC' as const };

    const hasAccess = await veterinaryAccessService.hasActiveAccess(maxId, clinicId);
    if (!hasAccess) {
      await veterinaryAccessService.grant(clinicRef, maxId, clinicOwnerActor);
    }

    const existingRecord = await knex('medical_records')
      .where({ animal_id: maxId, organization_id: clinicId })
      .first();
    if (!existingRecord) {
      await medicalRecordService.createForClinic(
        clinicId,
        { id: maxId, status: 'ACTIVE' },
        {
          visitDate: '2026-02-10',
          reason: 'Annual wellness examination',
          diagnosis: 'Healthy',
          treatment: 'None required',
          notes: 'Weight and vitals within normal range.',
        },
        clinicOwnerActor,
      );
    }

    const existingVax = await knex('vaccinations')
      .where({ animal_id: maxId, organization_id: clinicId })
      .first();
    if (!existingVax) {
      await vaccinationService.createForClinic(
        clinicId,
        { id: maxId, status: 'ACTIVE' },
        { vaccineName: 'Rabies', administeredOn: '2026-02-10', nextDueOn: '2027-02-10' },
        clinicOwnerActor,
      );
    }
  }

  async function seedFarmPoultry(): Promise<void> {
    const farmId = organizationIdsByKey.farm;
    if (!farmId) return;
    const actor = { actorUserId: must(userIdsByKey, 'farmOwner', 'user'), context: SEED_CONTEXT };

    await farmProfileService
      .updateProfile(
        farmId,
        {
          location: 'بابل - المسيب',
          governorate: 'بابل',
          address: 'محافظة بابل - المسيب، قرب الطريق العام',
          capacity: 10000,
          currentBirdCount: 8500,
          establishedOn: '2024-02-10',
          farmCategory: 'MIXED',
          contactName: 'مالك المزرعة',
          contactPhone: '+9647700000000',
          contactEmail: 'farm.owner@example.test',
        },
        actor,
      )
      .catch(() => undefined);

    const name = 'Broiler Batch A';
    const existingFlock = (await knex('poultry_flocks')
      .where({ organization_id: farmId, name })
      .first()) as { id: string } | undefined;

    const flockId = existingFlock
      ? existingFlock.id
      : (
          await poultryFlockService.create(
            { id: farmId, type: 'FARM' as const },
            {
              name,
              birdType: 'CHICKEN',
              birdCount: 5000,
              arrivalDate: '2026-02-01',
              notes: 'Dev flock.',
              initialBirdCount: 5000,
              averageWeightGrams: 230,
              targetPricePerKg: 2.5,
            },
            actor,
          )
        ).id;

    const seededRow = await knex('poultry_daily_records')
      .where({ poultry_flock_id: flockId })
      .first();
    if (seededRow) return;

    await poultryDailyRecordService.create(
      farmId,
      flockId,
      {
        recordDate: '2026-02-01',
        feedKg: 240,
        waterLiters: 2000,
        appetite: 'GOOD',
        activity: 'ACTIVE',
        mortalityCount: 20,
        mortalityCause: 'برد',
        treatment: 'فيتامينات + أملاح',
        expenseAmount: 850,
        averageWeightGrams: 230,
      },
      actor,
    );

    await farmExpenseService.create(
      farmId,
      {
        category: 'FEED',
        amount: 250000,
        description: 'شراء علف مركز للدفعة.',
        spentOn: '2026-02-02',
        poultryFlockId: flockId,
      },
      actor,
    );
    await farmExpenseService.create(
      farmId,
      {
        category: 'MEDICINE',
        amount: 75000,
        description: 'أدوية وفيتامينات.',
        spentOn: '2026-02-02',
      },
      actor,
    );

    await poultryHealthEventService.create(
      farmId,
      flockId,
      {
        kind: 'VACCINATION',
        name: 'نيوكاسل',
        dose: '1 مل',
        eventDate: '2026-02-05',
        coverageCount: 4980,
        nextDueDate: '2026-03-05',
        status: 'DONE',
      },
      actor,
    );

    await farmAppointmentService.create(
      farmId,
      {
        title: 'زيارة الطبيب المشرف',
        description: 'زيارة دورية لمتابعة صحة القطيع',
        category: 'VET_VISIT',
        scheduledFor: '2026-02-12',
        poultryFlockId: flockId,
      },
      actor,
    );

    await poultryCaseService.create(
      farmId,
      flockId,
      {
        animalTag: 'A-01',
        sex: 'FEMALE',
        diagnosis: 'ضعف عام',
        treatment: 'فيتامينات',
        startedOn: '2026-02-06',
        nextFollowupOn: '2026-02-09',
      },
      actor,
    );
  }

  async function seedStoreProducts(): Promise<void> {
    const storeId = organizationIdsByKey.store;
    if (!storeId) return;

    const storeRef = { id: storeId, type: 'VETERINARY_STORE' as const };
    const actor = {
      actorUserId: must(userIdsByKey, 'storeOwner', 'user'),
      context: SEED_CONTEXT,
    };

    const products = [
      {
        name: 'Amoxicillin 250mg',
        productType: 'MEDICINE' as const,
        price: '19.99',
        stockQuantity: 40,
        description: 'Broad-spectrum antibiotic tablets.',
      },
      {
        name: 'Digital Pet Thermometer',
        productType: 'EQUIPMENT' as const,
        price: '12.50',
        stockQuantity: 15,
        description: 'Fast-read rectal thermometer.',
      },
    ];

    for (const p of products) {
      const existing = await knex('products')
        .where({ organization_id: storeId, name: p.name })
        .first();
      if (existing) continue;
      await productService.create(storeRef, p, actor);
    }
  }

  async function seedWelcomeArticle(): Promise<void> {
    const title = 'Welcome to Bytari';
    const existing: { id: string } | undefined = await knex('contents')
      .where({ title, type: 'ARTICLE' })
      .first();
    const actor = { actorUserId: adminId, context: SEED_CONTEXT };

    let contentId = existing?.id;
    if (!contentId) {
      const created = await contentService.create(actor, {
        type: 'ARTICLE',
        title,
        description: 'Getting started with the Bytari veterinary platform.',
        body: 'This is a development seed article. Replace it with real content.',
        authorName: 'Bytari Team',
      });
      contentId = created.id;
    }

    const status = (await knex('contents').where({ id: contentId }).first()) as
      { status: string } | undefined;
    if (status?.status !== 'PUBLISHED') {
      await contentService.publish(actor, contentId);
    }
  }

  async function seedAdvertisements(): Promise<void> {
    const actor = { actorUserId: adminId, context: SEED_CONTEXT };

    interface SeedSlide {
      title?: string;
      subtitle?: string;
      ctaLabel?: string;
      ctaUrl?: string;
      file: string;
    }
    const campaigns: Array<{
      placement: string;
      type: 'BANNER' | 'CAROUSEL';
      title: string;
      slides: SeedSlide[];
    }> = [
      {
        placement: 'HOME',
        type: 'CAROUSEL',
        title: 'حملة الصفحة الرئيسية',
        slides: [
          {
            title: 'غذاء صحي لحياة أفضل',
            subtitle: 'أطعمة أصلية ومكملات غذائية',
            ctaLabel: 'تسوق الآن',
            ctaUrl: '/(app)/(tabs)/services',
            file: 'banner-1.jpg',
          },
          {
            title: 'استشر طبيبك البيطري في أي وقت',
            subtitle: 'فريق طبي متخصص جاهز للرد على استفساراتك',
            file: 'banner-2.jpg',
          },
          {
            title: 'تابع صحة حيوانك بسهولة',
            subtitle: 'سجلات طبية وتطعيمات في مكان واحد',
            file: 'banner-3.jpg',
          },
        ],
      },
      {
        placement: 'PETS',
        type: 'BANNER',
        title: 'حملة قسم الحيوانات الأليفة',
        slides: [
          {
            title: 'رعاية أفضل لحياة صحية وسعيدة',
            subtitle: 'نرعاهم كأنهم عائلتنا',
            file: 'banner-1.jpg',
          },
        ],
      },
      {
        placement: 'CLINICS',
        type: 'CAROUSEL',
        title: 'حملة قسم العيادات',
        slides: [
          {
            title: 'عيادات بيطرية موثوقة قريبة منك',
            subtitle: 'احجز موعدك في دقائق',
            file: 'banner-2.jpg',
          },
          {
            title: 'خصومات على الفحص الدوري',
            subtitle: 'لفترة محدودة',
            file: 'banner-3.jpg',
          },
        ],
      },
    ];

    for (const c of campaigns) {
      let existing: { id: string } | undefined = await knex('ad_campaigns')
        .where({ placement: c.placement, title: c.title })
        .first();

      if (!existing) {
        const created = await advertisementService.createCampaign(actor, {
          placement: c.placement,
          type: c.type,
          title: c.title,
          sortOrder: 0,
        });
        existing = { id: created.id };

        for (const s of c.slides) {
          const slide = await advertisementService.addSlide(actor, created.id, {
            title: s.title ?? null,
            subtitle: s.subtitle ?? null,
            ctaLabel: s.ctaLabel ?? null,
            ctaUrl: s.ctaUrl ?? null,
          });
          const bytes = await readFile(path.join(__dirname, 'assets', 'advertisements', s.file));
          const storageKey = buildObjectKey(StoragePrefix.advertisements, s.file);
          await objectStorage.put(storageKey, bytes, { contentType: 'image/jpeg' });
          await advertisementService.registerSlideImage(actor, created.id, slide.id, {
            storageKey,
            mimeType: 'image/jpeg',
          });
        }
        await advertisementService.setCampaignActive(actor, created.id, true);
      }
    }
  }

  async function seedTips(): Promise<void> {
    const actor = { actorUserId: adminId, context: SEED_CONTEXT };

    // Reuse `categories` for the tip taxonomy.
    const categories: Record<string, string> = {};
    for (const [slug, name] of [
      ['nutrition', 'التغذية'],
      ['health', 'الصحة'],
      ['production', 'الإنتاج'],
    ] as const) {
      const found = (await knex('categories').where({ slug }).whereNull('deleted_at').first()) as
        { id: string } | undefined;
      let id: string | undefined = found?.id;
      if (!id) {
        const inserted: Array<{ id: string }> = await knex('categories')
          .insert({ slug, name, created_by_user_id: adminId })
          .returning('id');
        id = inserted[0]?.id;
      }
      if (!id) throw new Error(`dev-seed: failed to resolve category "${slug}"`);
      categories[slug] = id;
    }

    const tips: Array<{
      title: string;
      summary: string;
      readMinutes: number;
      priority: 'IMPORTANT' | 'RECOMMENDED' | 'NORMAL';
      categorySlug: keyof typeof categories;
      bodyIntro: string;
      keyPoints: string[];
      warningPoints: string[];
      vetAdvice: string;
      tipOfDay?: boolean;
    }> = [
      {
        title: 'أفضل طرق تغذية الأغنام في الصيف',
        summary:
          'تعرف على تغذية متوازنة للطاقة والماء والمعادن للحفاظ على صحة الأغنام وإنتاجيتها في الأجواء الحارة.',
        readMinutes: 5,
        priority: 'IMPORTANT',
        categorySlug: 'nutrition',
        bodyIntro:
          'في فصل الصيف، تحتاج الأغنام إلى تغذية متوازنة تساعدها على تحمل الحرارة والحفاظ على إنتاجيتها وصحتها. الاهتمام بتوفير العلف الجيد، والماء النظيف، والمعادن الضرورية هو مفتاح نجاحك.',
        keyPoints: [
          'وفر علفاً جيداً وغنياً بالألياف مثل البرسيم أو الدريس.',
          'قدم الأعلاف في الصباح الباكر أو في المساء لتقليل تأثير الحرارة.',
          'تأكد من توفر ماء نظيف وبارد طوال اليوم.',
          'أضف الأملاح والمعادن لدعم صحة الأغنام وتعويض الفاقد.',
          'تجنب التغيير المفاجئ في نوع أو كمية العلف.',
        ],
        warningPoints: [
          'فقدان الشهية أو الامتناع عن الأكل.',
          'علامات الجفاف مثل اللسان الجاف أو الجلد الأقل مرونة.',
          'فقدان الوزن السريع أو الضعف العام.',
        ],
        vetAdvice:
          'إذا استمرت الأعراض لأكثر من يومين أو لاحظت إصابة عدة حيوانات معاً، يُنصح باستشارة طبيب بيطري لتشخيص الحالة والعلاج المناسب.',
        tipOfDay: true,
      },
      {
        title: 'أهم الفيتامينات لنمو الأغنام',
        summary: 'الفيتامينات الأساسية ودورها في نمو الحملان ومناعتها.',
        readMinutes: 4,
        priority: 'IMPORTANT',
        categorySlug: 'nutrition',
        bodyIntro: 'تلعب الفيتامينات A و D و E دوراً محورياً في نمو العظام والمناعة والخصوبة.',
        keyPoints: [
          'فيتامين A لصحة الجلد والعيون والمناعة.',
          'فيتامين D لامتصاص الكالسيوم ونمو العظام.',
          'فيتامين E مع السيلينيوم للوقاية من مرض العضلات البيضاء.',
        ],
        warningPoints: ['ضعف الحملان عند الولادة.', 'تكرار حالات الإسهال والالتهابات.'],
        vetAdvice: 'برنامج تكميل الفيتامينات يُحدد بحسب تحليل العلف واستشارة الطبيب البيطري.',
      },
      {
        title: 'كيفية التعامل مع حالات الإسهال عند العجول',
        summary: 'خطوات عملية لعزل العجل وتعويض السوائل ومنع انتشار العدوى.',
        readMinutes: 6,
        priority: 'RECOMMENDED',
        categorySlug: 'health',
        bodyIntro: 'الإسهال من أكثر أسباب نفوق العجول حديثة الولادة؛ السرعة في التدخل تنقذ حياتها.',
        keyPoints: [
          'اعزل العجل المصاب فوراً.',
          'عوّض السوائل والأملاح عن طريق الفم.',
          'استمر في الرضاعة ما لم ينصح الطبيب بغير ذلك.',
          'نظّف وطهّر مكان الإيواء.',
        ],
        warningPoints: ['جفاف واضح أو خمول شديد.', 'دم في البراز أو ارتفاع الحرارة.'],
        vetAdvice:
          'استشر الطبيب البيطري إذا لم تتحسن الحالة خلال ٢٤ ساعة أو ظهرت علامات جفاف شديد.',
      },
      {
        title: 'تحسين إنتاج الحليب في الأبقار الحلوب',
        summary: 'عوامل التغذية والراحة والحلب التي ترفع إنتاج الحليب وجودته.',
        readMinutes: 5,
        priority: 'RECOMMENDED',
        categorySlug: 'production',
        bodyIntro: 'إنتاج الحليب نتيجة تفاعل التغذية والوراثة والإدارة وصحة الضرع.',
        keyPoints: [
          'رتب علائق متوازنة الطاقة والبروتين.',
          'وفر ماء نظيفاً بكميات كافية.',
          'حافظ على نظافة الضرع وروتين حلب ثابت.',
          'قلل الإجهاد الحراري بالتهوية والتظليل.',
        ],
        warningPoints: ['انخفاض مفاجئ في الإنتاج.', 'تكتلات أو تغير لون الحليب.'],
        vetAdvice: 'الفحص الدوري للضرع واختبار التهاب الضرع تحت إشراف الطبيب البيطري.',
      },
    ];

    for (const tip of tips) {
      const existing = (await knex('content_tips').where({ title: tip.title }).first()) as
        { id: string; status: string; is_tip_of_day: boolean } | undefined;
      if (existing) continue;

      const created = await tipService.createTip(actor, {
        title: tip.title,
        summary: tip.summary,
        readMinutes: tip.readMinutes,
        priority: tip.priority,
        categoryId: categories[tip.categorySlug],
        bodyIntro: tip.bodyIntro,
        keyPoints: tip.keyPoints,
        warningPoints: tip.warningPoints,
        vetAdvice: tip.vetAdvice,
      });
      await tipService.publishTip(actor, created.id);
      if (tip.tipOfDay) await tipService.setTipOfDay(actor, created.id, true);
    }
  }

  async function seedNews(): Promise<void> {
    const actor = { actorUserId: adminId, context: SEED_CONTEXT };

    const categories: Record<string, string> = {};
    for (const [slug, name] of [
      ['prices-markets', 'الأسعار والأسواق'],
      ['husbandry', 'التربية والتغذية'],
      ['disease-prevention', 'الأمراض والوقاية'],
    ] as const) {
      const found = (await knex('categories').where({ slug }).whereNull('deleted_at').first()) as
        { id: string } | undefined;
      let id: string | undefined = found?.id;
      if (!id) {
        const inserted: Array<{ id: string }> = await knex('categories')
          .insert({ slug, name, created_by_user_id: adminId })
          .returning('id');
        id = inserted[0]?.id;
      }
      if (!id) throw new Error(`dev-seed: failed to resolve category "${slug}"`);
      categories[slug] = id;
    }

    const items: Array<{
      title: string;
      summary: string;
      source: string;
      isFeatured: boolean;
      tag: 'NORMAL' | 'URGENT' | 'IMPORTANT_ALERT';
      categorySlug: keyof typeof categories;
      body: string;
      reasonPoints: string[];
      advicePoints: string[];
      alertNote: string;
    }> = [
      {
        title: 'ارتفاع أسعار البيض في أغلب المحافظات اليوم',
        summary:
          'تشهد أسعار البيض ارتفاعاً ملحوظاً اليوم في معظم المحافظات نتيجة زيادة الطلب الموسمي وارتفاع تكاليف الإنتاج.',
        source: 'وزارة الزراعة العراقية',
        isFeatured: true,
        tag: 'NORMAL',
        categorySlug: 'prices-markets',
        body: 'أعلنت وزارة الزراعة العراقية عن ارتفاع أسعار البيض في أغلب المحافظات خلال اليوم بسبب ارتفاع تكاليف الأعلاف، وزيادة الطلب الموسمي، وارتفاع أجور النقل، مما أدى إلى زيادة في أسعار البيع للمستهلك.',
        reasonPoints: [
          'ارتفاع أسعار الأعلاف محلياً وعالمياً.',
          'زيادة الطلب على البيض مع اقتراب المواسم والأعياد.',
          'ارتفاع تكاليف النقل والمواصلات بين المحافظات.',
          'انخفاض معدل إنتاج البيض بسبب ارتفاع درجات الحرارة.',
        ],
        advicePoints: [
          'إدارة تكاليف الأعلاف والبحث عن بدائل مناسبة.',
          'تحسين التهوية والتبريد داخل الحقول.',
          'متابعة برامج التحصين والصحة باستمرار.',
          'تخطيط الإنتاج بما يتناسب مع الطلب الموسمي.',
        ],
        alertNote:
          'ننصح المربين بمتابعة تحديثات الأسعار بشكل يومي من المصادر الرسمية واتخاذ القرارات المناسبة لتقليل الخسائر وتحسين الإنتاج.',
      },
      {
        title: 'أهمية التهوية الجيدة في حقول الدواجن صيفاً',
        summary: 'التهوية السليمة تقلل الإجهاد الحراري وترفع معدلات النمو وتحد من النفوق.',
        source: 'الإرشاد البيطري',
        isFeatured: false,
        tag: 'URGENT',
        categorySlug: 'husbandry',
        body: 'مع ارتفاع درجات الحرارة تصبح التهوية الجيدة عاملاً حاسماً في الحفاظ على صحة القطيع وإنتاجيته، إذ تقلل من تراكم الغازات والرطوبة وتخفض حرارة العنبر.',
        reasonPoints: [
          'ارتفاع الحرارة يرفع معدل النفوق ويقلل استهلاك العلف.',
          'سوء التهوية يزيد رطوبة الفرشة وأمراض الجهاز التنفسي.',
        ],
        advicePoints: [
          'صيانة المراوح وأنظمة التبريد قبل موجات الحر.',
          'ضبط سرعة الهواء بحسب عمر الطيور.',
          'توفير ماء شرب بارد ونظيف طوال اليوم.',
        ],
        alertNote: 'راقب سلوك الطيور خلال ساعات الظهيرة وتدخّل سريعاً عند ظهور اللهاث الشديد.',
      },
      {
        title: 'تنبيه حول انتشار مرض تنفسي في بعض الحقول',
        summary: 'رصدت جهات بيطرية حالات إصابة بأعراض تنفسية في عدد من الحقول وتدعو للوقاية.',
        source: 'دائرة الثروة الحيوانية',
        isFeatured: false,
        tag: 'IMPORTANT_ALERT',
        categorySlug: 'disease-prevention',
        body: 'دعت الجهات البيطرية مربي الدواجن إلى تشديد إجراءات الأمان الحيوي بعد رصد حالات إصابة بأعراض تنفسية في عدد من الحقول، مع التأكيد على أهمية العزل والتحصين.',
        reasonPoints: [
          'ضعف إجراءات الأمان الحيوي عند مداخل الحقول.',
          'التقلبات الحرارية بين الليل والنهار.',
        ],
        advicePoints: [
          'منع دخول الزوار والمركبات دون تطهير.',
          'عزل أي طائر تظهر عليه أعراض ومتابعته.',
          'مراجعة برنامج التحصين مع الطبيب البيطري.',
        ],
        alertNote:
          'عند ارتفاع نسبة النفوق أو ظهور أعراض تنفسية واضحة، تواصل فوراً مع الطبيب المشرف.',
      },
    ];

    for (const item of items) {
      const existing = (await knex('news').where({ title: item.title }).first()) as
        { id: string } | undefined;
      if (existing) continue;

      const created = await newsService.createNews(actor, {
        title: item.title,
        summary: item.summary,
        source: item.source,
        isFeatured: item.isFeatured,
        tag: item.tag,
        categoryId: categories[item.categorySlug],
        body: item.body,
        reasonPoints: item.reasonPoints,
        advicePoints: item.advicePoints,
        alertNote: item.alertNote,
      });
      await newsService.publishNews(actor, created.id);
    }
  }
}

// --- standalone CLI entry ------------------------------------------------
// `npm run db:seed:dev` (or `tsx src/database/dev-seed/run.ts` directly).
// Mirrors `src/database/migrate.ts`'s connect → run → destroy pattern.

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const db = createKnex(config);
  try {
    const result = await runDevSeed(db, { config, logger });
    if (result.skipped) {
      logger.warn({ reason: result.reason }, 'dev-seed did not run');
    }
  } finally {
    await db.destroy();
  }
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  });
}
