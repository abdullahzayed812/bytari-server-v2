import type { Knex } from 'knex';

/**
 * Generalise the "Home ads" banner carousel into one multi-section
 * advertisement system:
 *
 *   ad_campaigns (placement, type BANNER|CAROUSEL, active, window, priority)
 *     └── ad_slides (ordered: image + title/subtitle/CTA)   ← the old `home_ads`
 *
 * Additive + backfilled: every existing `home_ads` row becomes a one-slide
 * BANNER campaign in placement `HOME`, so the live feed is unchanged (now
 * `GET /ads?placement=HOME`).
 *
 * Also generalises the RBAC identifiers this system was named after:
 *   permission `home_ad.manage` → `advertisement.manage`
 *   supervisor domain `HOME_AD` → `ADVERTISEMENT`
 *
 * A future section needs only a value in `AD_PLACEMENTS` + a one-line widening
 * of `chk_ad_campaigns_placement` — never a new table or API.
 */

const PLACEMENTS = [
  'HOME',
  'PETS',
  'CLINICS',
  'VETERINARY_OFFICES',
  'VETERINARY_STORES',
  'CONSULTATIONS',
  'COURSES',
  'SEMINARS',
];

const SUPERVISOR_DOMAINS_BEFORE = [
  'ANIMAL',
  'CLINIC',
  'STORE',
  'CONTENT',
  'CONSULTATION',
  'INQUIRY',
  'HOME_AD',
];
const SUPERVISOR_DOMAINS_AFTER = [
  'ANIMAL',
  'CLINIC',
  'STORE',
  'CONTENT',
  'CONSULTATION',
  'INQUIRY',
  'ADVERTISEMENT',
];

export async function up(knex: Knex): Promise<void> {
  // --- 1. parent: ad_campaigns -------------------------------------
  await knex.schema.createTable('ad_campaigns', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('placement').notNullable();
    t.text('type').notNullable().defaultTo('BANNER');
    t.text('title').notNullable();
    t.boolean('is_active').notNullable().defaultTo(false);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('starts_at', { useTz: true }).nullable();
    t.timestamp('ends_at', { useTz: true }).nullable();
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.uuid('updated_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('deleted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    `ALTER TABLE ad_campaigns ADD CONSTRAINT chk_ad_campaigns_placement
       CHECK (placement IN (${PLACEMENTS.map((p) => `'${p}'`).join(', ')}))`,
  );
  await knex.raw(
    `ALTER TABLE ad_campaigns ADD CONSTRAINT chk_ad_campaigns_type
       CHECK (type IN ('BANNER', 'CAROUSEL'))`,
  );
  await knex.raw(
    `ALTER TABLE ad_campaigns ADD CONSTRAINT chk_ad_campaigns_title_len
       CHECK (char_length(title) BETWEEN 1 AND 200)`,
  );
  await knex.raw(`
    CREATE INDEX idx_ad_campaigns_public ON ad_campaigns (placement, sort_order, created_at)
      WHERE is_active = true AND deleted_at IS NULL
  `);
  await knex.raw(
    `CREATE INDEX idx_ad_campaigns_admin ON ad_campaigns (placement, created_at DESC)`,
  );

  // --- 2. child: rename home_ads → ad_slides ---------------------
  await knex.schema.renameTable('home_ads', 'ad_slides');

  await knex.schema.alterTable('ad_slides', (t) => {
    t.uuid('campaign_id').nullable().references('id').inTable('ad_campaigns').onDelete('CASCADE');
    t.text('cta_label').nullable();
    t.text('cta_url').nullable();
  });

  // --- 3. backfill: one BANNER/HOME campaign per legacy slide ----
  const legacy = await knex('ad_slides').select(
    'id',
    'title',
    'sort_order',
    'is_active',
    'created_by_user_id',
    'deleted_at',
    'created_at',
    'updated_at',
  );
  for (const row of legacy) {
    const inserted = await knex('ad_campaigns')
      .insert({
        placement: 'HOME',
        type: 'BANNER',
        title: row.title,
        is_active: row.is_active,
        sort_order: row.sort_order,
        created_by_user_id: row.created_by_user_id,
        updated_by_user_id: row.created_by_user_id,
        deleted_at: row.deleted_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })
      .returning('id');
    const campaignId = inserted[0]?.id;
    if (!campaignId) throw new Error('ad_campaigns backfill insert returned no id');
    await knex('ad_slides')
      .where({ id: row.id })
      .update({ campaign_id: campaignId, sort_order: 0 });
  }

  // --- 4. finalise ad_slides shape -----------------------------
  await knex.raw(`ALTER TABLE ad_slides ALTER COLUMN campaign_id SET NOT NULL`);
  // A slide may be image-only (no title) — the old `home_ads.title` was required.
  await knex.raw(`ALTER TABLE ad_slides ALTER COLUMN title DROP NOT NULL`);
  await knex.raw(`DROP INDEX IF EXISTS idx_home_ads_public`);
  await knex.raw(`DROP INDEX IF EXISTS idx_home_ads_admin`);
  await knex.raw(`ALTER TABLE ad_slides DROP CONSTRAINT IF EXISTS chk_home_ads_title_len`);
  await knex.schema.alterTable('ad_slides', (t) => {
    t.dropColumn('is_active');
    t.dropColumn('deleted_at');
  });
  await knex.raw(
    `ALTER TABLE ad_slides ADD CONSTRAINT chk_ad_slides_title_len
       CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 200)`,
  );
  await knex.raw(`CREATE INDEX idx_ad_slides_campaign ON ad_slides (campaign_id, sort_order)`);

  // --- 5. RBAC: generalise the HOME-specific identifiers --------
  await knex('permissions').where({ key: 'home_ad.manage' }).update({
    key: 'advertisement.manage',
    description:
      'Create, update, activate/deactivate and delete advertisement campaigns and slides across all placements',
    updated_at: knex.fn.now(),
  });

  await knex.raw(`ALTER TABLE system_supervisor_assignments DROP CONSTRAINT chk_supervisor_domain`);
  await knex('system_supervisor_assignments')
    .where({ domain: 'HOME_AD' })
    .update({ domain: 'ADVERTISEMENT', updated_at: knex.fn.now() });
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN (${SUPERVISOR_DOMAINS_AFTER.map((d) => `'${d}'`).join(', ')}))
  `);
}

export async function down(knex: Knex): Promise<void> {
  // --- RBAC ---
  await knex.raw(`ALTER TABLE system_supervisor_assignments DROP CONSTRAINT chk_supervisor_domain`);
  await knex('system_supervisor_assignments')
    .where({ domain: 'ADVERTISEMENT' })
    .update({ domain: 'HOME_AD', updated_at: knex.fn.now() });
  await knex.raw(`
    ALTER TABLE system_supervisor_assignments
      ADD CONSTRAINT chk_supervisor_domain
      CHECK (domain IN (${SUPERVISOR_DOMAINS_BEFORE.map((d) => `'${d}'`).join(', ')}))
  `);
  await knex('permissions').where({ key: 'advertisement.manage' }).update({
    key: 'home_ad.manage',
    description: 'Create, update, activate/deactivate and delete the Home ad carousel',
    updated_at: knex.fn.now(),
  });

  // --- schema: collapse ad_slides back to home_ads --------------
  await knex.raw(`DROP INDEX IF EXISTS idx_ad_slides_campaign`);
  await knex.raw(`ALTER TABLE ad_slides DROP CONSTRAINT IF EXISTS chk_ad_slides_title_len`);
  await knex.schema.alterTable('ad_slides', (t) => {
    t.boolean('is_active').notNullable().defaultTo(false);
    t.timestamp('deleted_at', { useTz: true }).nullable();
  });
  // Restore is_active / deleted_at from the parent campaign before dropping it.
  await knex.raw(`
    UPDATE ad_slides s
       SET is_active = c.is_active, deleted_at = c.deleted_at
      FROM ad_campaigns c
     WHERE s.campaign_id = c.id
  `);
  await knex.schema.alterTable('ad_slides', (t) => {
    t.dropColumn('campaign_id');
    t.dropColumn('cta_label');
    t.dropColumn('cta_url');
  });
  await knex.raw(`UPDATE ad_slides SET title = 'Untitled' WHERE title IS NULL`);
  await knex.raw(`ALTER TABLE ad_slides ALTER COLUMN title SET NOT NULL`);
  await knex.raw(
    `ALTER TABLE ad_slides ADD CONSTRAINT chk_home_ads_title_len
       CHECK (char_length(title) BETWEEN 1 AND 200)`,
  );
  await knex.schema.renameTable('ad_slides', 'home_ads');
  await knex.raw(`
    CREATE INDEX idx_home_ads_public ON home_ads (sort_order, created_at)
      WHERE is_active = true AND deleted_at IS NULL AND image_storage_key IS NOT NULL
  `);
  await knex.raw(`CREATE INDEX idx_home_ads_admin ON home_ads (created_at DESC)`);

  await knex.schema.dropTableIfExists('ad_campaigns');
}
