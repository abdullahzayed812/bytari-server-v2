import type { Knex } from 'knex';

/**
 * Poultry Farm operations — the data behind the Poultry Farm Details screen.
 *
 * Phase 6 (`20260830010000_farms.ts`) added only `poultry_flocks` (a batch of
 * birds) and left "production / mortality / feed / health sub-entities" as
 * explicit future extension points. This migration fills them in, all pinned to
 * a `FARM` organization at the database level via the same immutable
 * `organization_type` + composite FK pattern `poultry_flocks` uses.
 *
 * (The Farm Details header profile itself — image / address / capacity /
 * establishment date / production type — is consolidated into `farm_details`
 * in `20260827010000_organizations.ts`, which owns that table.)
 *
 *   1. `poultry_flocks` += the batch-summary inputs (batch number, initial
 *      count, average weight, an optional target price for the profit estimate,
 *      expected sale date). Current count / age / estimated profit are
 *      DERIVED server-side from these + the daily records — never stored.
 *   2. `poultry_daily_records`  — one row per (flock, calendar day): feed,
 *      water, appetite, activity, mortality, treatment, expense, weight, notes.
 *      Backs the "البيانات اليومية" list and every "ملخص الأسبوع" aggregate.
 *   3. `farm_expenses`           — "المصاريف" (feed / medicine / water / …).
 *   4. `poultry_health_events`   — "العلاجات واللقاحات" (treatment | vaccination).
 *   5. `farm_appointments`       — "المواعيد".
 *   6. `poultry_cases`           — "الحالات الفردية".
 *
 * No new farm-membership / role tables — organization RBAC (Phase 3) governs
 * every route; the new `farm.*` permission keys are additive in
 * `organization-rbac.constants.ts` and applied by the idempotent seed.
 */

const FARM_FK = (t: Knex.CreateTableBuilder, name: string): void => {
  t.uuid('organization_id').notNullable();
  t.text('organization_type').notNullable().defaultTo('FARM');
  t.foreign(['organization_id', 'organization_type'], name)
    .references(['id', 'type'])
    .inTable('organizations')
    .onDelete('RESTRICT');
};

export async function up(knex: Knex): Promise<void> {
  // --- 1. poultry_flocks batch-summary inputs ------------------------------
  await knex.schema.alterTable('poultry_flocks', (t) => {
    t.integer('batch_number').nullable();
    t.integer('initial_bird_count').nullable();
    t.decimal('average_weight_grams', 12, 2).nullable();
    t.decimal('target_price_per_kg', 12, 2).nullable();
    t.date('expected_sale_date').nullable();
  });
  await knex.raw(
    `ALTER TABLE poultry_flocks ADD CONSTRAINT chk_poultry_flocks_batch_number
       CHECK (batch_number IS NULL OR batch_number >= 1)`,
  );
  await knex.raw(
    `ALTER TABLE poultry_flocks ADD CONSTRAINT chk_poultry_flocks_initial_count
       CHECK (initial_bird_count IS NULL OR initial_bird_count >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE poultry_flocks ADD CONSTRAINT chk_poultry_flocks_avg_weight
       CHECK (average_weight_grams IS NULL OR average_weight_grams >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE poultry_flocks ADD CONSTRAINT chk_poultry_flocks_target_price
       CHECK (target_price_per_kg IS NULL OR target_price_per_kg >= 0)`,
  );
  // At most one batch number per farm (nulls allowed for legacy rows).
  await knex.raw(
    `CREATE UNIQUE INDEX uq_poultry_flocks_batch_number
       ON poultry_flocks (organization_id, batch_number)
       WHERE batch_number IS NOT NULL`,
  );
  // Backfill: give every existing flock a per-farm batch number + initial count.
  await knex.raw(`
    WITH numbered AS (
      SELECT id,
             row_number() OVER (PARTITION BY organization_id ORDER BY created_at, id) AS n
        FROM poultry_flocks
    )
    UPDATE poultry_flocks f
       SET batch_number = numbered.n,
           initial_bird_count = f.bird_count
      FROM numbered
     WHERE numbered.id = f.id
  `);

  // --- 2. poultry_daily_records ------------------------------------------
  await knex.schema.createTable('poultry_daily_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('poultry_flock_id')
      .notNullable()
      .references('id')
      .inTable('poultry_flocks')
      .onDelete('CASCADE');
    FARM_FK(t, 'fk_poultry_daily_records_farm');
    t.date('record_date').notNullable();
    t.decimal('feed_kg', 12, 2).notNullable().defaultTo(0);
    t.decimal('water_liters', 12, 2).notNullable().defaultTo(0);
    t.text('appetite').nullable();
    t.text('activity').nullable();
    t.integer('mortality_count').notNullable().defaultTo(0);
    t.text('mortality_cause').nullable();
    t.text('treatment').nullable();
    t.decimal('expense_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('average_weight_grams', 12, 2).nullable();
    t.text('notes').nullable();
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['poultry_flock_id', 'record_date'], {
      indexName: 'uq_poultry_daily_records_flock_date',
    });
    t.index(['poultry_flock_id', 'record_date'], 'idx_poultry_daily_records_flock_date');
  });
  await knex.raw(
    `ALTER TABLE poultry_daily_records ADD CONSTRAINT chk_pdr_org_type CHECK (organization_type = 'FARM')`,
  );
  await knex.raw(
    `ALTER TABLE poultry_daily_records ADD CONSTRAINT chk_pdr_appetite
       CHECK (appetite IS NULL OR appetite IN ('GOOD', 'NORMAL', 'WEAK', 'NONE'))`,
  );
  await knex.raw(
    `ALTER TABLE poultry_daily_records ADD CONSTRAINT chk_pdr_activity
       CHECK (activity IS NULL OR activity IN ('ACTIVE', 'NORMAL', 'LETHARGIC'))`,
  );
  await knex.raw(
    `ALTER TABLE poultry_daily_records ADD CONSTRAINT chk_pdr_nonneg
       CHECK (feed_kg >= 0 AND water_liters >= 0 AND mortality_count >= 0
              AND expense_amount >= 0
              AND (average_weight_grams IS NULL OR average_weight_grams >= 0))`,
  );

  // --- 3. farm_expenses -------------------------------------------------
  await knex.schema.createTable('farm_expenses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    FARM_FK(t, 'fk_farm_expenses_farm');
    t.uuid('poultry_flock_id')
      .nullable()
      .references('id')
      .inTable('poultry_flocks')
      .onDelete('SET NULL');
    t.text('category').notNullable();
    t.decimal('amount', 14, 2).notNullable();
    t.text('description').nullable();
    t.date('spent_on').notNullable();
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['organization_id', 'spent_on'], 'idx_farm_expenses_org_date');
    t.index('poultry_flock_id', 'idx_farm_expenses_flock');
  });
  await knex.raw(
    `ALTER TABLE farm_expenses ADD CONSTRAINT chk_farm_expenses_org_type CHECK (organization_type = 'FARM')`,
  );
  await knex.raw(
    `ALTER TABLE farm_expenses ADD CONSTRAINT chk_farm_expenses_category
       CHECK (category IN ('FEED', 'MEDICINE', 'WATER_TRANSPORT', 'LABOR', 'UTILITIES', 'EQUIPMENT', 'OTHER'))`,
  );
  await knex.raw(
    `ALTER TABLE farm_expenses ADD CONSTRAINT chk_farm_expenses_amount CHECK (amount >= 0)`,
  );

  // --- 4. poultry_health_events --------------------------------------
  await knex.schema.createTable('poultry_health_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('poultry_flock_id')
      .notNullable()
      .references('id')
      .inTable('poultry_flocks')
      .onDelete('CASCADE');
    FARM_FK(t, 'fk_poultry_health_events_farm');
    t.text('kind').notNullable();
    t.text('name').notNullable();
    t.text('medication').nullable();
    t.text('dose').nullable();
    t.date('event_date').notNullable();
    t.integer('cases_count').nullable();
    t.integer('coverage_count').nullable();
    t.date('next_due_date').nullable();
    t.text('status').notNullable().defaultTo('DONE');
    t.text('notes').nullable();
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['poultry_flock_id', 'event_date'], 'idx_phe_flock_date');
    t.index(['poultry_flock_id', 'kind'], 'idx_phe_flock_kind');
  });
  await knex.raw(
    `ALTER TABLE poultry_health_events ADD CONSTRAINT chk_phe_org_type CHECK (organization_type = 'FARM')`,
  );
  await knex.raw(
    `ALTER TABLE poultry_health_events ADD CONSTRAINT chk_phe_kind CHECK (kind IN ('TREATMENT', 'VACCINATION'))`,
  );
  await knex.raw(
    `ALTER TABLE poultry_health_events ADD CONSTRAINT chk_phe_status
       CHECK (status IN ('SCHEDULED', 'ONGOING', 'DONE', 'RECOVERED'))`,
  );
  await knex.raw(
    `ALTER TABLE poultry_health_events ADD CONSTRAINT chk_phe_counts
       CHECK ((cases_count IS NULL OR cases_count >= 0)
              AND (coverage_count IS NULL OR coverage_count >= 0))`,
  );

  // --- 5. farm_appointments ----------------------------------------
  await knex.schema.createTable('farm_appointments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    FARM_FK(t, 'fk_farm_appointments_farm');
    t.uuid('poultry_flock_id')
      .nullable()
      .references('id')
      .inTable('poultry_flocks')
      .onDelete('SET NULL');
    t.text('title').notNullable();
    t.text('description').nullable();
    t.text('category').notNullable().defaultTo('OTHER');
    t.date('scheduled_for').notNullable();
    t.text('status').notNullable().defaultTo('UPCOMING');
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['organization_id', 'scheduled_for'], 'idx_farm_appointments_org_date');
  });
  await knex.raw(
    `ALTER TABLE farm_appointments ADD CONSTRAINT chk_farm_appointments_org_type CHECK (organization_type = 'FARM')`,
  );
  await knex.raw(
    `ALTER TABLE farm_appointments ADD CONSTRAINT chk_farm_appointments_category
       CHECK (category IN ('VACCINATION', 'TREATMENT', 'INDIVIDUAL_CASE', 'VET_VISIT', 'OTHER'))`,
  );
  await knex.raw(
    `ALTER TABLE farm_appointments ADD CONSTRAINT chk_farm_appointments_status
       CHECK (status IN ('UPCOMING', 'DONE', 'CANCELLED'))`,
  );

  // --- 6. poultry_cases ------------------------------------------
  await knex.schema.createTable('poultry_cases', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('poultry_flock_id')
      .notNullable()
      .references('id')
      .inTable('poultry_flocks')
      .onDelete('CASCADE');
    FARM_FK(t, 'fk_poultry_cases_farm');
    t.integer('case_number').nullable();
    t.text('animal_tag').nullable();
    t.text('sex').notNullable().defaultTo('UNKNOWN');
    t.text('diagnosis').nullable();
    t.text('treatment').nullable();
    t.text('status').notNullable().defaultTo('UNDER_TREATMENT');
    t.date('started_on').notNullable();
    t.date('next_followup_on').nullable();
    t.text('image_key').nullable();
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['poultry_flock_id', 'status'], 'idx_poultry_cases_flock_status');
    t.unique(['poultry_flock_id', 'case_number'], { indexName: 'uq_poultry_cases_flock_number' });
  });
  await knex.raw(
    `ALTER TABLE poultry_cases ADD CONSTRAINT chk_poultry_cases_org_type CHECK (organization_type = 'FARM')`,
  );
  await knex.raw(
    `ALTER TABLE poultry_cases ADD CONSTRAINT chk_poultry_cases_sex CHECK (sex IN ('MALE', 'FEMALE', 'UNKNOWN'))`,
  );
  await knex.raw(
    `ALTER TABLE poultry_cases ADD CONSTRAINT chk_poultry_cases_status
       CHECK (status IN ('UNDER_TREATMENT', 'RECOVERED', 'DECEASED'))`,
  );
  await knex.raw(
    `ALTER TABLE poultry_cases ADD CONSTRAINT chk_poultry_cases_number
       CHECK (case_number IS NULL OR case_number >= 1)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('poultry_cases');
  await knex.schema.dropTableIfExists('farm_appointments');
  await knex.schema.dropTableIfExists('poultry_health_events');
  await knex.schema.dropTableIfExists('farm_expenses');
  await knex.schema.dropTableIfExists('poultry_daily_records');

  await knex.raw(`DROP INDEX IF EXISTS uq_poultry_flocks_batch_number`);
  for (const c of [
    'chk_poultry_flocks_batch_number',
    'chk_poultry_flocks_initial_count',
    'chk_poultry_flocks_avg_weight',
    'chk_poultry_flocks_target_price',
  ]) {
    await knex.raw(`ALTER TABLE poultry_flocks DROP CONSTRAINT IF EXISTS ${c}`);
  }
  await knex.schema.alterTable('poultry_flocks', (t) => {
    t.dropColumn('batch_number');
    t.dropColumn('initial_bird_count');
    t.dropColumn('average_weight_grams');
    t.dropColumn('target_price_per_kg');
    t.dropColumn('expected_sale_date');
  });
}
