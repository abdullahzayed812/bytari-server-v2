import type { Knex } from 'knex';

/**
 * Sheep Farms — mirrors `20260830010000_farms.ts` + `20260912010000_
 * poultry_operations.ts`'s `poultry_flocks`/children exactly, with the
 * bird-type picker replaced by an age/sex headcount breakdown (lambs/males/
 * females), weights in kg (not grams), and two new daily-record fields
 * (`sick_cases_count`, `feed_type`). Same `organization_type='FARM'` composite
 * FK pattern pinning every row to a FARM organization at the DB level.
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
  // --- sheep_batches -------------------------------------------------
  await knex.schema.createTable('sheep_batches', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    FARM_FK(t, 'fk_sheep_batches_farm');
    t.text('name').notNullable();
    t.text('breed').nullable();
    t.integer('head_count').notNullable();
    t.integer('lamb_count').nullable();
    t.integer('male_count').nullable();
    t.integer('female_count').nullable();
    t.date('arrival_date').notNullable();
    t.text('status').notNullable().defaultTo('ACTIVE');
    t.text('notes').nullable();
    t.integer('batch_number').nullable();
    t.integer('initial_head_count').nullable();
    t.decimal('average_weight_kg', 12, 2).nullable();
    t.decimal('target_price_per_kg', 12, 2).nullable();
    t.date('expected_sale_date').nullable();
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('closed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('organization_id', 'idx_sheep_batches_org');
    t.index(['organization_id', 'status'], 'idx_sheep_batches_org_status');
  });
  await knex.raw(
    `ALTER TABLE sheep_batches ADD CONSTRAINT chk_sheep_batches_org_type CHECK (organization_type = 'FARM')`,
  );
  await knex.raw(
    `ALTER TABLE sheep_batches ADD CONSTRAINT chk_sheep_batches_status CHECK (status IN ('ACTIVE', 'CLOSED'))`,
  );
  await knex.raw(
    `ALTER TABLE sheep_batches ADD CONSTRAINT chk_sheep_batches_counts
       CHECK (head_count >= 0
              AND (lamb_count IS NULL OR lamb_count >= 0)
              AND (male_count IS NULL OR male_count >= 0)
              AND (female_count IS NULL OR female_count >= 0)
              AND (batch_number IS NULL OR batch_number >= 1)
              AND (initial_head_count IS NULL OR initial_head_count >= 0)
              AND (average_weight_kg IS NULL OR average_weight_kg >= 0)
              AND (target_price_per_kg IS NULL OR target_price_per_kg >= 0))`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX uq_sheep_batches_batch_number
       ON sheep_batches (organization_id, batch_number)
       WHERE batch_number IS NOT NULL`,
  );

  // --- sheep_daily_records --------------------------------------------
  await knex.schema.createTable('sheep_daily_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('sheep_batch_id').notNullable().references('id').inTable('sheep_batches').onDelete('CASCADE');
    FARM_FK(t, 'fk_sheep_daily_records_farm');
    t.date('record_date').notNullable();
    t.decimal('feed_kg', 12, 2).notNullable().defaultTo(0);
    t.decimal('water_liters', 12, 2).notNullable().defaultTo(0);
    t.text('appetite').nullable();
    t.text('activity').nullable();
    t.integer('mortality_count').notNullable().defaultTo(0);
    t.text('mortality_cause').nullable();
    t.integer('sick_cases_count').notNullable().defaultTo(0);
    t.text('feed_type').nullable();
    t.text('treatment').nullable();
    t.decimal('expense_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('average_weight_kg', 12, 2).nullable();
    t.text('notes').nullable();
    t.uuid('created_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['sheep_batch_id', 'record_date'], { indexName: 'uq_sheep_daily_records_batch_date' });
    t.index(['sheep_batch_id', 'record_date'], 'idx_sheep_daily_records_batch_date');
  });
  await knex.raw(
    `ALTER TABLE sheep_daily_records ADD CONSTRAINT chk_sdr_org_type CHECK (organization_type = 'FARM')`,
  );
  await knex.raw(
    `ALTER TABLE sheep_daily_records ADD CONSTRAINT chk_sdr_appetite
       CHECK (appetite IS NULL OR appetite IN ('GOOD', 'NORMAL', 'WEAK', 'NONE'))`,
  );
  await knex.raw(
    `ALTER TABLE sheep_daily_records ADD CONSTRAINT chk_sdr_activity
       CHECK (activity IS NULL OR activity IN ('ACTIVE', 'NORMAL', 'LETHARGIC'))`,
  );
  await knex.raw(
    `ALTER TABLE sheep_daily_records ADD CONSTRAINT chk_sdr_feed_type
       CHECK (feed_type IS NULL OR feed_type IN ('CONCENTRATED', 'GREEN_FODDER', 'MIXED', 'OTHER'))`,
  );
  await knex.raw(
    `ALTER TABLE sheep_daily_records ADD CONSTRAINT chk_sdr_nonneg
       CHECK (feed_kg >= 0 AND water_liters >= 0 AND mortality_count >= 0 AND sick_cases_count >= 0
              AND expense_amount >= 0
              AND (average_weight_kg IS NULL OR average_weight_kg >= 0))`,
  );

  // --- sheep_health_events --------------------------------------------
  await knex.schema.createTable('sheep_health_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('sheep_batch_id').notNullable().references('id').inTable('sheep_batches').onDelete('CASCADE');
    FARM_FK(t, 'fk_sheep_health_events_farm');
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

    t.index(['sheep_batch_id', 'event_date'], 'idx_sheep_health_events_batch_date');
    t.index(['sheep_batch_id', 'kind'], 'idx_sheep_health_events_batch_kind');
  });
  await knex.raw(
    `ALTER TABLE sheep_health_events ADD CONSTRAINT chk_she_org_type CHECK (organization_type = 'FARM')`,
  );
  await knex.raw(
    `ALTER TABLE sheep_health_events ADD CONSTRAINT chk_she_kind CHECK (kind IN ('TREATMENT', 'VACCINATION'))`,
  );
  await knex.raw(
    `ALTER TABLE sheep_health_events ADD CONSTRAINT chk_she_status
       CHECK (status IN ('SCHEDULED', 'ONGOING', 'DONE', 'RECOVERED'))`,
  );
  await knex.raw(
    `ALTER TABLE sheep_health_events ADD CONSTRAINT chk_she_counts
       CHECK ((cases_count IS NULL OR cases_count >= 0)
              AND (coverage_count IS NULL OR coverage_count >= 0))`,
  );

  // --- sheep_cases -----------------------------------------------
  await knex.schema.createTable('sheep_cases', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('sheep_batch_id').notNullable().references('id').inTable('sheep_batches').onDelete('CASCADE');
    FARM_FK(t, 'fk_sheep_cases_farm');
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

    t.index(['sheep_batch_id', 'status'], 'idx_sheep_cases_batch_status');
    t.unique(['sheep_batch_id', 'case_number'], { indexName: 'uq_sheep_cases_batch_number' });
  });
  await knex.raw(
    `ALTER TABLE sheep_cases ADD CONSTRAINT chk_sheep_cases_org_type CHECK (organization_type = 'FARM')`,
  );
  await knex.raw(
    `ALTER TABLE sheep_cases ADD CONSTRAINT chk_sheep_cases_sex CHECK (sex IN ('MALE', 'FEMALE', 'UNKNOWN'))`,
  );
  await knex.raw(
    `ALTER TABLE sheep_cases ADD CONSTRAINT chk_sheep_cases_status
       CHECK (status IN ('UNDER_TREATMENT', 'RECOVERED', 'DECEASED'))`,
  );
  await knex.raw(
    `ALTER TABLE sheep_cases ADD CONSTRAINT chk_sheep_cases_number CHECK (case_number IS NULL OR case_number >= 1)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('sheep_cases');
  await knex.schema.dropTableIfExists('sheep_health_events');
  await knex.schema.dropTableIfExists('sheep_daily_records');
  await knex.raw(`DROP INDEX IF EXISTS uq_sheep_batches_batch_number`);
  await knex.schema.dropTableIfExists('sheep_batches');
}
