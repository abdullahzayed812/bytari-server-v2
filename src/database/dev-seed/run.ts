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
  const { homeAdService, objectStorage } = container;

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
  await seedHomeAds();

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

    const name = 'Broiler Batch A';
    const existing = await knex('poultry_flocks').where({ organization_id: farmId, name }).first();
    if (existing) return;

    await poultryFlockService.create(
      { id: farmId, type: 'FARM' as const },
      {
        name,
        birdType: 'CHICKEN',
        birdCount: 5000,
        arrivalDate: '2026-02-01',
        notes: 'Dev flock.',
      },
      { actorUserId: must(userIdsByKey, 'farmOwner', 'user'), context: SEED_CONTEXT },
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

  async function seedHomeAds(): Promise<void> {
    const actor = { actorUserId: adminId, context: SEED_CONTEXT };
    const banners: Array<{ title: string; subtitle: string; sortOrder: number; file: string }> = [
      {
        title: 'رعاية أفضل لحياة صحية وسعيدة',
        subtitle: 'نرعاهم كأنهم عائلتنا',
        sortOrder: 0,
        file: 'banner-1.jpg',
      },
      {
        title: 'استشر طبيبك البيطري في أي وقت',
        subtitle: 'فريق طبي متخصص جاهز للرد على استفساراتك',
        sortOrder: 1,
        file: 'banner-2.jpg',
      },
      {
        title: 'تابع صحة حيوانك بسهولة',
        subtitle: 'سجلات طبية وتطعيمات في مكان واحد',
        sortOrder: 2,
        file: 'banner-3.jpg',
      },
    ];

    for (const b of banners) {
      const existing: { id: string } | undefined = await knex('home_ads')
        .where({ title: b.title })
        .first();

      let homeAdId = existing?.id;
      if (!homeAdId) {
        const created = await homeAdService.create(actor, {
          title: b.title,
          subtitle: b.subtitle,
          sortOrder: b.sortOrder,
        });
        homeAdId = created.id;
      }

      const row = (await knex('home_ads').where({ id: homeAdId }).first()) as
        { image_storage_key: string | null; is_active: boolean } | undefined;
      if (!row?.image_storage_key) {
        const bytes = await readFile(path.join(__dirname, 'assets', 'home-ads', b.file));
        const storageKey = buildObjectKey(StoragePrefix.homeAds, b.file);
        await objectStorage.put(storageKey, bytes, { contentType: 'image/jpeg' });
        await homeAdService.registerImage(actor, homeAdId, {
          storageKey,
          mimeType: 'image/jpeg',
        });
      }
      if (!row?.is_active) {
        await homeAdService.setActive(actor, homeAdId, true);
      }
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
