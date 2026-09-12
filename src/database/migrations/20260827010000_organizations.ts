import type { Knex } from 'knex';

/**
 * Organizations: the unified `organizations` aggregate plus thin per-subtype
 * detail tables.
 *
 *   organizations
 *       ├── clinic_details              (public directory profile)
 *       ├── farm_details                (join_code + the Poultry/Sheep/Cattle
 *       │                                 Farm Details header profile +
 *       │                                 subscription window)
 *       ├── veterinary_office_details   (public directory profile)
 *       └── veterinary_store_details    (public directory profile)
 *
 * Organizations are never physically deleted — the `status` lifecycle
 * (PENDING → ACTIVE / REJECTED / SUSPENDED / DEACTIVATED) governs access.
 * `owner_user_id` is `ON DELETE RESTRICT`: a user who owns organizations
 * cannot be removed. The owner is *also* represented in
 * `organization_memberships` (next migration) as an OWNER membership.
 *
 * CLINIC / VETERINARY_OFFICE / VETERINARY_STORE share the same public
 * directory profile shape (address / coordinates / contact / working hours /
 * services / social links / photo gallery) — the Pet Owner marketplace pages
 * need it, computing "nearest" with a plain SQL haversine expression at query
 * time (no PostGIS; the data volume doesn't need it). FARM keeps its own
 * shape instead: it isn't part of that directory, and has its own
 * Poultry/Sheep/Cattle-specific header profile.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('organizations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('type').notNullable();
    t.text('name').notNullable();
    t.text('description').nullable();
    t.uuid('owner_user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.text('status').notNullable().defaultTo('PENDING');
    t.uuid('decided_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('decided_at', { useTz: true }).nullable();
    t.text('decision_reason').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('owner_user_id', 'idx_organizations_owner');
    t.index('status', 'idx_organizations_status');
    t.index(['type', 'status'], 'idx_organizations_type_status');
  });

  await knex.raw(`
    ALTER TABLE organizations
      ADD CONSTRAINT chk_organizations_type
      CHECK (type IN ('CLINIC', 'FARM', 'VETERINARY_OFFICE', 'VETERINARY_STORE', 'SYNDICATE'))
  `);
  await knex.raw(`
    ALTER TABLE organizations
      ADD CONSTRAINT chk_organizations_status
      CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'DEACTIVATED'))
  `);

  // --- CLINIC / VETERINARY_OFFICE / VETERINARY_STORE directory profile ----
  const DIRECTORY_TABLES = ['clinic_details', 'veterinary_office_details', 'veterinary_store_details'];
  for (const table of DIRECTORY_TABLES) {
    await knex.schema.createTable(table, (t) => {
      t.uuid('organization_id')
        .primary()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.text('address').nullable();
      t.double('latitude').nullable();
      t.double('longitude').nullable();
      t.text('phone').nullable();
      t.text('logo_key').nullable();
      t.text('working_hours').nullable();
      t.specificType('services', 'text[]').nullable();
      t.text('email').nullable();
      t.text('whatsapp').nullable();
      t.text('instagram_url').nullable();
      t.text('facebook_url').nullable();
      t.text('tiktok_url').nullable();
      t.specificType('gallery_keys', 'text[]').notNullable().defaultTo('{}');
    });
    await knex.raw(`
      ALTER TABLE ${table} ADD CONSTRAINT chk_${table}_latitude
        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90)
    `);
    await knex.raw(`
      ALTER TABLE ${table} ADD CONSTRAINT chk_${table}_longitude
        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
    `);
    // Both-or-neither — a lone coordinate can't be distance-sorted anyway.
    await knex.raw(`
      ALTER TABLE ${table} ADD CONSTRAINT chk_${table}_coords_pair
        CHECK ((latitude IS NULL) = (longitude IS NULL))
    `);
    await knex.raw(`
      CREATE INDEX idx_${table}_coords ON ${table} (latitude, longitude)
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    `);
  }

  // --- FARM: join_code + the Poultry/Sheep/Cattle Farm Details profile ----
  await knex.schema.createTable('farm_details', (t) => {
    t.uuid('organization_id')
      .primary()
      .references('id')
      .inTable('organizations')
      .onDelete('CASCADE');
    // The "Farm ID" a veterinarian enters to join (spec §19).
    t.text('join_code').notNullable().unique();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // Header profile: image / address / capacity / establishment date /
    // production type (POULTRY-specific; SHEEP/CATTLE get their own below).
    t.text('image_key').nullable();
    t.text('image_provider').nullable();
    t.text('address').nullable();
    t.integer('capacity').nullable();
    t.date('established_on').nullable();
    t.text('poultry_production_type').nullable();
    // "Add Poultry Farm" form fields.
    t.text('location').nullable();
    t.text('governorate').nullable();
    t.integer('current_bird_count').nullable();
    t.text('contact_name').nullable();
    t.text('contact_phone').nullable();
    t.text('contact_email').nullable();
    // Subscription window — validity is derived server-side vs `now()`
    // (see `computeFarmSubscriptionStatus`), deliberately not a stored status.
    t.date('subscription_start_date').nullable();
    t.date('subscription_end_date').nullable();
    // Sheep Farms & Cattle Farms — additive columns shared by all species.
    t.text('farm_species').nullable();
    t.integer('current_sheep_count').nullable();
    t.integer('current_cattle_count').nullable();
    t.text('sheep_production_type').nullable();
    t.text('cattle_production_type').nullable();
  });
  await knex.raw(
    `ALTER TABLE farm_details ADD CONSTRAINT chk_farm_details_capacity
       CHECK (capacity IS NULL OR capacity >= 0)`,
  );
  // Constraint keeps its original name from when the column was named
  // `farm_category` (renamed to `poultry_production_type` — same type, same
  // values, same semantics, just a less misleadingly-generic name).
  await knex.raw(
    `ALTER TABLE farm_details ADD CONSTRAINT chk_farm_details_category
       CHECK (poultry_production_type IS NULL OR poultry_production_type IN
         ('BROILER', 'LAYER', 'MIXED', 'BREEDER', 'HATCHERY', 'OTHER'))`,
  );
  await knex.raw(
    `ALTER TABLE farm_details ADD CONSTRAINT chk_farm_details_current_bird_count
       CHECK (current_bird_count IS NULL OR current_bird_count >= 0)`,
  );
  await knex.raw(`
    ALTER TABLE farm_details
      ADD CONSTRAINT chk_farm_details_subscription_dates
      CHECK (
        subscription_start_date IS NULL
        OR subscription_end_date IS NULL
        OR subscription_end_date >= subscription_start_date
      )
  `);
  await knex.raw(
    `ALTER TABLE farm_details ADD CONSTRAINT chk_farm_details_species
       CHECK (farm_species IS NULL OR farm_species IN ('POULTRY', 'SHEEP', 'CATTLE', 'MIXED'))`,
  );
  await knex.raw(
    `ALTER TABLE farm_details ADD CONSTRAINT chk_farm_details_sheep_count
       CHECK (current_sheep_count IS NULL OR current_sheep_count >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE farm_details ADD CONSTRAINT chk_farm_details_cattle_count
       CHECK (current_cattle_count IS NULL OR current_cattle_count >= 0)`,
  );
  await knex.raw(
    `ALTER TABLE farm_details ADD CONSTRAINT chk_farm_details_sheep_production_type
       CHECK (sheep_production_type IS NULL OR sheep_production_type IN
         ('MEAT', 'DAIRY', 'WOOL', 'BREEDING', 'MIXED', 'OTHER'))`,
  );
  await knex.raw(
    `ALTER TABLE farm_details ADD CONSTRAINT chk_farm_details_cattle_production_type
       CHECK (cattle_production_type IS NULL OR cattle_production_type IN
         ('DAIRY', 'BEEF', 'BREEDING', 'MIXED', 'OTHER'))`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('veterinary_store_details');
  await knex.schema.dropTableIfExists('veterinary_office_details');
  await knex.schema.dropTableIfExists('farm_details');
  await knex.schema.dropTableIfExists('clinic_details');
  await knex.schema.dropTableIfExists('organizations');
}
