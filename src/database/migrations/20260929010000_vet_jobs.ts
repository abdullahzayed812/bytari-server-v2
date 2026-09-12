import type { Knex } from 'knex';

/**
 * Veterinarian Jobs / Careers ("الوظائف البيطرية").
 *
 * Two moderated entities — employer-posted job OFFERS and veterinarian
 * SEEKER PROFILES ("باحثون عن عمل") — sharing the reusable PENDING →
 * APPROVED / REJECTED lifecycle already used by `vet_service_listings` /
 * `vet_service_requests` / `animal_publications`. One engagement entity
 * (a veterinarian's APPLICATION against an offer) has its own
 * PENDING → ACCEPTED / REJECTED lifecycle, decided by the offer's poster (not
 * a moderator). On ACCEPTED, a chat conversation is created — reusing the
 * existing `PET_OWNER_VETERINARIAN` conversation type as-is (any user may
 * post a job; the applicant is guaranteed to be an approved veterinarian),
 * pinned via a new `VET_JOB_APPLICATION` conversation `subject_type`. No new
 * conversation type / column / shape change is needed for this.
 *
 * Tables:
 *   vet_job_offers            — employer-posted job ads (moderated)
 *   vet_job_seeker_profiles   — veterinarian "looking for a job" profiles (moderated)
 *   vet_job_applications      — a veterinarian's application against one offer
 */
export async function up(knex: Knex): Promise<void> {
  // --- job offers --------------------------------------------------------
  await knex.schema.createTable('vet_job_offers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('posted_by_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.uuid('organization_id').nullable().references('id').inTable('organizations').onDelete('SET NULL');
    /** Display name snapshot — always shown, even without an `organization_id` link. */
    t.text('organization_name').notNullable();
    t.text('title').notNullable();
    t.text('employment_type').notNullable();
    t.text('governorate').notNullable();
    t.text('district').nullable();
    t.decimal('salary_amount', 12, 2).nullable();
    t.boolean('salary_negotiable').notNullable().defaultTo(false);
    t.integer('experience_years_required').nullable();
    t.text('qualifications').nullable();
    t.text('description').notNullable();
    /** Bullet lists shown on the details screen — "المهام والمسؤوليات" / "المتطلبات" / "مزايا". */
    t.jsonb('responsibilities').nullable();
    t.jsonb('requirements').nullable();
    t.jsonb('benefits').nullable();
    t.text('contact_phone').notNullable();
    t.text('contact_email').nullable();
    t.date('application_deadline').nullable();
    t.text('status').notNullable().defaultTo('PENDING');
    t.uuid('reviewed_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.text('rejection_reason').nullable();
    /** "إلغاء الإعلان" — the poster closes their own approved ad early. */
    t.timestamp('closed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('status', 'idx_vjo_status');
    t.index(['status', 'created_at'], 'idx_vjo_status_created');
    t.index('posted_by_user_id', 'idx_vjo_poster');
  });
  await knex.raw(
    `ALTER TABLE vet_job_offers ADD CONSTRAINT chk_vjo_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))`,
  );
  await knex.raw(
    `ALTER TABLE vet_job_offers ADD CONSTRAINT chk_vjo_employment_type
       CHECK (employment_type IN ('FULL_TIME', 'PART_TIME', 'SHIFT', 'EVENING', 'OTHER'))`,
  );
  await knex.raw(
    `ALTER TABLE vet_job_offers ADD CONSTRAINT chk_vjo_salary CHECK (salary_amount IS NULL OR salary_amount >= 0)`,
  );

  // --- job seeker profiles ------------------------------------------------
  await knex.schema.createTable('vet_job_seeker_profiles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('specialty').notNullable();
    /** "نبذة شخصية" — short bio. */
    t.text('headline').nullable();
    t.integer('experience_years').notNullable().defaultTo(0);
    t.text('governorate').notNullable();
    t.text('district').nullable();
    t.text('qualifications').nullable();
    t.jsonb('skills').nullable();
    /** Multi-select of the same `employment_type` vocabulary as job offers. */
    t.jsonb('preferred_employment_types').nullable();
    t.text('phone').notNullable();
    t.text('email').nullable();
    t.text('cv_storage_key').nullable();
    t.text('photo_storage_key').nullable();
    t.text('status').notNullable().defaultTo('PENDING');
    t.uuid('reviewed_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.text('rejection_reason').nullable();
    /** The veterinarian pauses their own approved listing. */
    t.timestamp('closed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('status', 'idx_vjsp_status');
    t.index(['status', 'created_at'], 'idx_vjsp_status_created');
  });
  await knex.raw(`CREATE UNIQUE INDEX uq_vjsp_user ON vet_job_seeker_profiles (user_id)`);
  await knex.raw(
    `ALTER TABLE vet_job_seeker_profiles ADD CONSTRAINT chk_vjsp_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))`,
  );
  await knex.raw(
    `ALTER TABLE vet_job_seeker_profiles ADD CONSTRAINT chk_vjsp_experience CHECK (experience_years >= 0)`,
  );

  // --- applications (veterinarian → offer) --------------------------------
  await knex.schema.createTable('vet_job_applications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('job_offer_id')
      .notNullable()
      .references('id')
      .inTable('vet_job_offers')
      .onDelete('CASCADE');
    t.uuid('applicant_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.text('full_name').notNullable();
    t.text('phone').notNullable();
    t.text('email').nullable();
    t.text('specialty').nullable();
    t.integer('experience_years').nullable();
    t.text('qualifications').nullable();
    /** "معلومات إضافية" — a short cover note. */
    t.text('cover_note').nullable();
    t.text('cv_storage_key').nullable();
    t.text('photo_storage_key').nullable();
    t.text('status').notNullable().defaultTo('PENDING');
    t.uuid('reviewed_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    /** Set once the poster accepts — the resulting chat thread. */
    t.uuid('conversation_id').nullable().references('id').inTable('conversations').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('job_offer_id', 'idx_vja_offer');
    t.index('applicant_user_id', 'idx_vja_applicant');
  });
  await knex.raw(
    `CREATE UNIQUE INDEX uq_vja_offer_applicant ON vet_job_applications (job_offer_id, applicant_user_id)`,
  );
  await knex.raw(
    `ALTER TABLE vet_job_applications ADD CONSTRAINT chk_vja_status CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED'))`,
  );

  // --- RBAC widening (mirrors the in-place-edit + re-ALTER convention used
  // for VETERINARIAN_STORE — this repo is still pre-release) ----------------
  await knex.raw(`ALTER TABLE system_supervisor_assignments DROP CONSTRAINT IF EXISTS chk_supervisor_domain`);
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN (
        'ANIMAL', 'CLINIC', 'STORE', 'CONTENT', 'CONSULTATION', 'INQUIRY',
        'SUPPORT', 'ADVERTISEMENT', 'MARKET', 'PET_OWNER_STORE', 'VET_SERVICE',
        'VETERINARIAN_STORE', 'VET_JOBS'
      ))
  `);

  // --- chat: widen the subject_type an existing PET_OWNER_VETERINARIAN
  // conversation may be pinned to, so it can point at a job application too.
  // No new conversation `type`, column, or shape change is needed. --------
  await knex.raw(`ALTER TABLE conversations DROP CONSTRAINT IF EXISTS chk_conversations_subject`);
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_subject
      CHECK (
        (subject_type IS NULL AND subject_id IS NULL) OR
        (subject_type IN ('VET_SERVICE_OFFER', 'VET_SERVICE_LISTING_REQUEST', 'VET_JOB_APPLICATION') AND subject_id IS NOT NULL)
      )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TABLE conversations DROP CONSTRAINT IF EXISTS chk_conversations_subject`);
  await knex.raw(`
    ALTER TABLE conversations ADD CONSTRAINT chk_conversations_subject
      CHECK (
        (subject_type IS NULL AND subject_id IS NULL) OR
        (subject_type IN ('VET_SERVICE_OFFER', 'VET_SERVICE_LISTING_REQUEST') AND subject_id IS NOT NULL)
      )
  `);
  await knex.raw(`ALTER TABLE system_supervisor_assignments DROP CONSTRAINT IF EXISTS chk_supervisor_domain`);
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN (
        'ANIMAL', 'CLINIC', 'STORE', 'CONTENT', 'CONSULTATION', 'INQUIRY',
        'SUPPORT', 'ADVERTISEMENT', 'MARKET', 'PET_OWNER_STORE', 'VET_SERVICE',
        'VETERINARIAN_STORE'
      ))
  `);
  await knex.schema.dropTableIfExists('vet_job_applications');
  await knex.schema.dropTableIfExists('vet_job_seeker_profiles');
  await knex.schema.dropTableIfExists('vet_job_offers');
}
