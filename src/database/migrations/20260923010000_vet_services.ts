import type { Knex } from 'knex';

/**
 * Veterinary Services marketplace ("الخدمات").
 *
 * Two MODERATED entities that reuse the animal-publication PENDING → APPROVED /
 * REJECTED lifecycle (`rejection_reason`, `reviewed_by_user_id`, `reviewed_at`):
 *
 *   vet_service_listings   a Veterinarian publishes a service ("نشر الخدمة")
 *   vet_service_requests   a Pet Owner publishes a standalone request ("نشر الطلب")
 *
 * Two ENGAGEMENT entities with an ACCEPTED → COMPLETED lifecycle. On accept a
 * `PET_OWNER_VETERINARIAN` conversation is created (see the sibling chat
 * migration) and its id is stored on `conversation_id`:
 *
 *   vet_service_offers            a Vet applies to a Pet Owner request ("تقديم عرض")
 *   vet_service_listing_requests  a Pet Owner requests a specific listing ("طلب العرض")
 *
 * Images are R2 object keys in a `text[]` column, resolved to signed URLs by the
 * service layer — same convention as `animals.gallery_keys`. Money is
 * PostgreSQL `numeric` (returned as a string by `pg`).
 *
 * `request_number` ("#REQ-2024-00125") is app-formatted from a shared sequence
 * so both request kinds draw from one monotonic counter.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`CREATE SEQUENCE IF NOT EXISTS vet_service_request_seq`);

  const MODERATION = `('PENDING', 'APPROVED', 'REJECTED')`;
  const ENGAGEMENT = `('PENDING', 'ACCEPTED', 'COMPLETED', 'REJECTED', 'CANCELLED')`;
  const ANIMAL_TYPES = `('DOG','CAT','BIRD','POULTRY','SHEEP','GOAT','CATTLE','HORSE','CAMEL','FISH','OTHER')`;
  const SERVICE_TYPES = `('VACCINATION','EXAMINATION','TREATMENT','SURGERY','ARTIFICIAL_INSEMINATION','FOLLOW_UP','HOME_VISIT','DIAGNOSIS','CONSULTATION','OTHER')`;

  // --- listings ------------------------------------------------------
  await knex.schema.createTable('vet_service_listings', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('veterinarian_user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.text('title').notNullable();
    t.text('description').notNullable();
    t.text('service_type').notNullable();
    t.text('animal_type').notNullable();
    t.text('specialty').nullable();
    t.text('governorate').notNullable();
    t.text('district').nullable();
    t.decimal('price_amount', 14, 2).nullable();
    t.text('price_type').notNullable().defaultTo('APPROXIMATE');
    t.text('location_mode').notNullable().defaultTo('CLINIC');
    t.text('availability').nullable();
    t.text('contact_phone').nullable();
    t.text('contact_whatsapp').nullable();
    t.text('execution_duration').nullable();
    t.text('arrival_time').nullable();
    t.specificType('details', 'text[]').notNullable().defaultTo('{}');
    t.specificType('image_keys', 'text[]').notNullable().defaultTo('{}');
    t.text('status').notNullable().defaultTo('PENDING');
    t.uuid('reviewed_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.text('rejection_reason').nullable();
    t.timestamp('closed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('veterinarian_user_id', 'idx_vsl_vet');
    t.index(['status', 'closed_at'], 'idx_vsl_status');
    t.index(['status', 'governorate'], 'idx_vsl_status_gov');
  });
  await knex.raw(
    `ALTER TABLE vet_service_listings ADD CONSTRAINT chk_vsl_status CHECK (status IN ${MODERATION})`,
  );
  await knex.raw(
    `ALTER TABLE vet_service_listings ADD CONSTRAINT chk_vsl_price_type CHECK (price_type IN ('FIXED','APPROXIMATE','NEGOTIABLE'))`,
  );
  await knex.raw(
    `ALTER TABLE vet_service_listings ADD CONSTRAINT chk_vsl_location_mode CHECK (location_mode IN ('CLINIC','FIELD_VISIT','BOTH'))`,
  );
  await knex.raw(
    `ALTER TABLE vet_service_listings ADD CONSTRAINT chk_vsl_animal_type CHECK (animal_type IN ${ANIMAL_TYPES})`,
  );
  await knex.raw(
    `ALTER TABLE vet_service_listings ADD CONSTRAINT chk_vsl_service_type CHECK (service_type IN ${SERVICE_TYPES})`,
  );
  await knex.raw(
    `ALTER TABLE vet_service_listings ADD CONSTRAINT chk_vsl_price_amount CHECK (price_amount IS NULL OR price_amount >= 0)`,
  );

  // --- requests ----------------------------------------------------
  await knex.schema.createTable('vet_service_requests', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('request_number').notNullable().unique();
    t.uuid('pet_owner_user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.text('title').notNullable();
    t.text('description').notNullable();
    t.text('animal_type').notNullable();
    t.text('service_type').notNullable();
    t.integer('animal_count').nullable();
    t.text('animal_age').nullable();
    t.text('governorate').notNullable();
    t.text('district').nullable();
    t.text('detailed_address').nullable();
    t.boolean('needs_field_visit').notNullable().defaultTo(false);
    t.date('preferred_date').nullable();
    t.decimal('budget_amount', 14, 2).nullable();
    t.text('urgency').notNullable().defaultTo('NORMAL');
    t.text('extra_notes').nullable();
    t.specificType('image_keys', 'text[]').notNullable().defaultTo('{}');
    t.text('status').notNullable().defaultTo('PENDING');
    t.uuid('reviewed_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.text('rejection_reason').nullable();
    t.timestamp('closed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('pet_owner_user_id', 'idx_vsr_owner');
    t.index(['status', 'closed_at'], 'idx_vsr_status');
    t.index(['status', 'urgency', 'created_at'], 'idx_vsr_status_urgency');
  });
  await knex.raw(
    `ALTER TABLE vet_service_requests ADD CONSTRAINT chk_vsr_status CHECK (status IN ${MODERATION})`,
  );
  await knex.raw(
    `ALTER TABLE vet_service_requests ADD CONSTRAINT chk_vsr_urgency CHECK (urgency IN ('NORMAL','URGENT'))`,
  );
  await knex.raw(
    `ALTER TABLE vet_service_requests ADD CONSTRAINT chk_vsr_animal_type CHECK (animal_type IN ${ANIMAL_TYPES})`,
  );
  await knex.raw(
    `ALTER TABLE vet_service_requests ADD CONSTRAINT chk_vsr_service_type CHECK (service_type IN ${SERVICE_TYPES})`,
  );
  await knex.raw(
    `ALTER TABLE vet_service_requests ADD CONSTRAINT chk_vsr_count CHECK (animal_count IS NULL OR animal_count > 0)`,
  );
  await knex.raw(
    `ALTER TABLE vet_service_requests ADD CONSTRAINT chk_vsr_budget CHECK (budget_amount IS NULL OR budget_amount >= 0)`,
  );

  // --- offers (vet → request) -----------------------------------
  await knex.schema.createTable('vet_service_offers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('request_id')
      .notNullable()
      .references('id')
      .inTable('vet_service_requests')
      .onDelete('CASCADE');
    t.uuid('veterinarian_user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.decimal('proposed_amount', 14, 2).nullable();
    t.date('execution_date').nullable();
    t.text('expected_duration').nullable();
    t.boolean('includes_field_visit').nullable();
    t.text('details').nullable();
    t.specificType('image_keys', 'text[]').notNullable().defaultTo('{}');
    t.text('status').notNullable().defaultTo('PENDING');
    t.uuid('conversation_id').nullable();
    t.timestamp('decided_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('request_id', 'idx_vso_request');
    t.index(['veterinarian_user_id', 'status'], 'idx_vso_vet_status');
  });
  await knex.raw(
    `ALTER TABLE vet_service_offers ADD CONSTRAINT chk_vso_status CHECK (status IN ${ENGAGEMENT})`,
  );
  await knex.raw(
    `ALTER TABLE vet_service_offers ADD CONSTRAINT chk_vso_amount CHECK (proposed_amount IS NULL OR proposed_amount >= 0)`,
  );
  // At most one non-terminal offer per (request, vet).
  await knex.raw(
    `CREATE UNIQUE INDEX uq_vso_open ON vet_service_offers (request_id, veterinarian_user_id)
       WHERE status IN ('PENDING', 'ACCEPTED')`,
  );

  // --- listing requests (owner → listing) ----------------------
  await knex.schema.createTable('vet_service_listing_requests', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('request_number').notNullable().unique();
    t.uuid('listing_id')
      .notNullable()
      .references('id')
      .inTable('vet_service_listings')
      .onDelete('CASCADE');
    t.uuid('pet_owner_user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.text('animal_type').notNullable();
    t.integer('animal_count').nullable();
    t.text('animal_age').nullable();
    t.text('governorate').nullable();
    t.text('district').nullable();
    t.boolean('needs_field_visit').notNullable().defaultTo(false);
    t.timestamp('preferred_datetime', { useTz: true }).nullable();
    t.decimal('budget_amount', 14, 2).nullable();
    t.text('notes').nullable();
    t.boolean('previous_visit').nullable();
    t.specificType('image_keys', 'text[]').notNullable().defaultTo('{}');
    t.text('status').notNullable().defaultTo('PENDING');
    t.uuid('conversation_id').nullable();
    t.timestamp('decided_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index('listing_id', 'idx_vslr_listing');
    t.index(['pet_owner_user_id', 'status'], 'idx_vslr_owner_status');
  });
  await knex.raw(
    `ALTER TABLE vet_service_listing_requests ADD CONSTRAINT chk_vslr_status CHECK (status IN ${ENGAGEMENT})`,
  );
  await knex.raw(
    `ALTER TABLE vet_service_listing_requests ADD CONSTRAINT chk_vslr_animal_type CHECK (animal_type IN ${ANIMAL_TYPES})`,
  );
  await knex.raw(
    `ALTER TABLE vet_service_listing_requests ADD CONSTRAINT chk_vslr_budget CHECK (budget_amount IS NULL OR budget_amount >= 0)`,
  );
  await knex.raw(
    `CREATE UNIQUE INDEX uq_vslr_open ON vet_service_listing_requests (listing_id, pet_owner_user_id)
       WHERE status IN ('PENDING', 'ACCEPTED')`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('vet_service_listing_requests');
  await knex.schema.dropTableIfExists('vet_service_offers');
  await knex.schema.dropTableIfExists('vet_service_requests');
  await knex.schema.dropTableIfExists('vet_service_listings');
  await knex.raw(`DROP SEQUENCE IF EXISTS vet_service_request_seq`);
}
