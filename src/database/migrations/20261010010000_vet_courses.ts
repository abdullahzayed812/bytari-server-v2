import type { Knex } from 'knex';

/**
 * Veterinarian Courses & Seminars ("الدورات والندوات").
 *
 * One moderated entity — a veterinarian-created COURSE / SEMINAR / WORKSHOP,
 * distinguished by a `type` column — sharing the reusable PENDING →
 * APPROVED / REJECTED lifecycle already used by `vet_job_offers` /
 * `vet_service_listings` / `animal_publications`. One engagement entity (a
 * veterinarian's REGISTRATION against an approved course) has no moderation
 * of its own — it is enforced synchronously (capacity / deadline / at most
 * one registration per user, via a DB unique index), mirroring the
 * uniqueness pattern of `vet_job_applications`.
 *
 * Tables:
 *   vet_courses               — veterinarian-created courses/seminars/workshops (moderated)
 *   vet_course_registrations  — a veterinarian's registration against one course
 */
export async function up(knex: Knex): Promise<void> {
  // --- courses / seminars / workshops -------------------------------------
  await knex.schema.createTable('vet_courses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('creator_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.text('type').notNullable();
    t.text('title').notNullable();
    t.text('description').notNullable();
    /** "الجهة المنظمة". */
    t.text('organizing_body').notNullable();
    /** "المحاضر". */
    t.text('instructor_name').notNullable();
    /** Instructor's specialty (e.g. "التغذية والتغذية السريرية") — not the registrant's. */
    t.text('instructor_specialty').nullable();
    t.date('start_date').notNullable();
    t.date('end_date').notNullable();
    t.text('start_time').nullable();
    t.text('end_time').nullable();
    /** e.g. "بتوقيت بغداد" — display-only. */
    t.text('timezone_note').nullable();
    t.text('location_mode').notNullable();
    /** "أونلاين عبر Zoom" or "حضوري - بغداد" — free text either way. */
    t.text('location_details').notNullable();
    /** Total seats — NULL means unlimited. */
    t.integer('capacity').nullable();
    /** NULL/absent means "مجانية" (free). */
    t.decimal('price', 12, 2).nullable();
    t.date('registration_deadline').nullable();
    /** "محاور الدورة" — the outline checklist shown on the details screen. */
    t.jsonb('topics').nullable();
    t.text('cover_image_storage_key').nullable();
    t.text('status').notNullable().defaultTo('PENDING');
    t.uuid('reviewed_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.text('rejection_reason').nullable();
    /** The creator (or a moderator) cancels an approved course — "تم إلغاء الدورة". */
    t.timestamp('cancelled_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('status', 'idx_vc_status');
    t.index(['status', 'start_date'], 'idx_vc_status_start');
    t.index('creator_user_id', 'idx_vc_creator');
  });
  await knex.raw(
    `ALTER TABLE vet_courses ADD CONSTRAINT chk_vc_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))`,
  );
  await knex.raw(
    `ALTER TABLE vet_courses ADD CONSTRAINT chk_vc_type CHECK (type IN ('COURSE', 'SEMINAR', 'WORKSHOP'))`,
  );
  await knex.raw(
    `ALTER TABLE vet_courses ADD CONSTRAINT chk_vc_location_mode CHECK (location_mode IN ('ONLINE', 'IN_PERSON'))`,
  );
  await knex.raw(
    `ALTER TABLE vet_courses ADD CONSTRAINT chk_vc_capacity CHECK (capacity IS NULL OR capacity >= 1)`,
  );
  await knex.raw(
    `ALTER TABLE vet_courses ADD CONSTRAINT chk_vc_price CHECK (price IS NULL OR price >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE vet_courses ADD CONSTRAINT chk_vc_dates CHECK (end_date >= start_date)`,
  );

  // --- registrations (veterinarian → course) --------------------------------
  await knex.schema.createTable('vet_course_registrations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('course_id').notNullable().references('id').inTable('vet_courses').onDelete('CASCADE');
    t.uuid('registrant_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.text('full_name').notNullable();
    t.text('phone').notNullable();
    t.text('email').nullable();
    t.text('governorate').notNullable();
    t.text('specialty').nullable();
    /** "ملاحظات (اختياري)". */
    t.text('notes').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('course_id', 'idx_vcr_course');
    t.index('registrant_user_id', 'idx_vcr_registrant');
  });
  await knex.raw(
    `CREATE UNIQUE INDEX uq_vcr_course_registrant ON vet_course_registrations (course_id, registrant_user_id)`,
  );

  // --- RBAC widening (mirrors the in-place-edit + re-ALTER convention used
  // for VET_JOBS — this repo is still pre-release) ------------------------
  await knex.raw(`ALTER TABLE system_supervisor_assignments DROP CONSTRAINT IF EXISTS chk_supervisor_domain`);
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN (
        'ANIMAL', 'CLINIC', 'STORE', 'CONTENT', 'CONSULTATION', 'INQUIRY',
        'SUPPORT', 'ADVERTISEMENT', 'MARKET', 'PET_OWNER_STORE', 'VET_SERVICE',
        'VETERINARIAN_STORE', 'VET_JOBS', 'VET_COURSES'
      ))
  `);
}

export async function down(knex: Knex): Promise<void> {
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
  await knex.schema.dropTableIfExists('vet_course_registrations');
  await knex.schema.dropTableIfExists('vet_courses');
}
