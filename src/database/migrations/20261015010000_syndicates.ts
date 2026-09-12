import type { Knex } from 'knex';

/**
 * Veterinary Syndicates / Unions ("نقابة الأطباء البيطريين").
 *
 * A syndicate is an `organizations` row (`type = 'SYNDICATE'`), reusing the
 * existing organization aggregate + its per-instance membership/supervisor
 * RBAC (`organization_memberships` / `organization_supervisor_permissions`)
 * and follow feature (`organization_follows`) as-is — see
 * `server/src/modules/syndicates/domain/syndicate.constants.ts` for the full
 * reuse rationale. Only the syndicate-specific extension tables are new:
 *
 *   syndicate_details       — profile fields + the main/branch hierarchy
 *                              (`parent_organization_id`, one level deep)
 *   syndicate_announcements — "الإعلانات والتبليغات"
 *   syndicate_submissions   — "طلبات" (kind=REQUEST) + "استفسارات" (kind=INQUIRY)
 */
export async function up(knex: Knex): Promise<void> {
  // --- widen the organizations type enum ----------------------------------
  await knex.raw(`ALTER TABLE organizations DROP CONSTRAINT IF EXISTS chk_organizations_type`);
  await knex.raw(`
    ALTER TABLE organizations
      ADD CONSTRAINT chk_organizations_type
      CHECK (type IN ('CLINIC', 'FARM', 'VETERINARY_OFFICE', 'VETERINARY_STORE', 'SYNDICATE'))
  `);

  // --- syndicate profile + hierarchy --------------------------------------
  await knex.schema.createTable('syndicate_details', (t) => {
    t.uuid('organization_id').primary().references('id').inTable('organizations').onDelete('CASCADE');
    /** NULL = main syndicate; set = a subordinate/branch of that main syndicate. */
    t.uuid('parent_organization_id').nullable().references('id').inTable('organizations').onDelete('RESTRICT');
    t.text('governorate').nullable();
    t.text('address').nullable();
    t.text('phone').nullable();
    t.text('email').nullable();
    t.text('website').nullable();
    t.text('logo_key').nullable();
    /** "اسم نقيب الأطباء". */
    t.text('head_officer_name').nullable();
    /** e.g. "نقيب الأطباء البيطريين العراقيين". */
    t.text('head_officer_title').nullable();
    t.integer('term_start_year').nullable();
    t.integer('term_end_year').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('parent_organization_id', 'idx_syndicate_details_parent');
  });
  await knex.raw(`
    ALTER TABLE syndicate_details
      ADD CONSTRAINT chk_syndicate_details_not_self_parent
      CHECK (parent_organization_id IS NULL OR parent_organization_id <> organization_id)
  `);

  // --- announcements ("الإعلانات والتبليغات") -----------------------------
  await knex.schema.createTable('syndicate_announcements', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.text('type').notNullable().defaultTo('ANNOUNCEMENT');
    t.text('title').notNullable();
    t.text('body').notNullable();
    t.text('image_key').nullable();
    t.uuid('created_by_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('published_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['organization_id', 'published_at'], 'idx_syndicate_announcements_org_published');
  });
  await knex.raw(`
    ALTER TABLE syndicate_announcements ADD CONSTRAINT chk_syndicate_announcements_type
      CHECK (type IN ('ANNOUNCEMENT', 'IMPORTANT_NOTICE'))
  `);

  // --- submissions: requests ("طلبات") + inquiries ("استفسارات") ----------
  await knex.schema.createTable('syndicate_submissions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.text('kind').notNullable();
    /** Only set when `kind = 'REQUEST'`. */
    t.text('request_type').nullable();
    t.text('message').notNullable();
    /** "الحد الأقصى 5 صور". */
    t.specificType('attachment_keys', 'text[]').notNullable().defaultTo('{}');
    t.uuid('submitted_by_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.text('status').notNullable().defaultTo('PENDING');
    t.text('response_text').nullable();
    t.uuid('responded_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('responded_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['organization_id', 'status', 'created_at'], 'idx_syndicate_submissions_org_status');
    t.index('submitted_by_user_id', 'idx_syndicate_submissions_submitter');
  });
  await knex.raw(`
    ALTER TABLE syndicate_submissions ADD CONSTRAINT chk_syndicate_submissions_kind
      CHECK (kind IN ('REQUEST', 'INQUIRY'))
  `);
  await knex.raw(`
    ALTER TABLE syndicate_submissions ADD CONSTRAINT chk_syndicate_submissions_request_type
      CHECK (request_type IS NULL OR request_type IN
        ('ID_ISSUANCE', 'ID_RENEWAL', 'OFFICE_LICENSE_ISSUANCE', 'OFFICE_LICENSE_RENEWAL', 'OTHER'))
  `);
  await knex.raw(`
    ALTER TABLE syndicate_submissions ADD CONSTRAINT chk_syndicate_submissions_status
      CHECK (status IN ('PENDING', 'RESPONDED', 'CLOSED'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('syndicate_submissions');
  await knex.schema.dropTableIfExists('syndicate_announcements');
  await knex.schema.dropTableIfExists('syndicate_details');

  await knex.raw(`ALTER TABLE organizations DROP CONSTRAINT IF EXISTS chk_organizations_type`);
  await knex.raw(`
    ALTER TABLE organizations
      ADD CONSTRAINT chk_organizations_type
      CHECK (type IN ('CLINIC', 'FARM', 'VETERINARY_OFFICE', 'VETERINARY_STORE'))
  `);
}
