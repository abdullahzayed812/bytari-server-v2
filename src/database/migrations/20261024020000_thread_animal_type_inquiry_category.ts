import type { Knex } from 'knex';

/**
 * Consultations may now name a GENERIC animal type instead of (or as well as)
 * one of the creator's owned animals; inquiries carry a category.
 *
 * - `consultations.animal_type` — reuses the platform's existing animal-type
 *   vocabulary (`VET_SERVICE_ANIMAL_TYPES`: DOG, CAT, BIRD, POULTRY, SHEEP,
 *   GOAT, CATTLE, HORSE, CAMEL, FISH, OTHER). Nullable: legacy consultations
 *   have only `animal_id` (or nothing) and keep working unchanged.
 * - `inquiries.category` — EMERGENCY / GENERAL / SURGERY / MEDICATION /
 *   DISEASES / NUTRITION / OTHER. Nullable for legacy rows; the API defaults
 *   new inquiries to GENERAL when the client sends none.
 */
const ANIMAL_TYPES = [
  'DOG',
  'CAT',
  'BIRD',
  'POULTRY',
  'SHEEP',
  'GOAT',
  'CATTLE',
  'HORSE',
  'CAMEL',
  'FISH',
  'OTHER',
];
const INQUIRY_CATEGORIES = [
  'EMERGENCY',
  'GENERAL',
  'SURGERY',
  'MEDICATION',
  'DISEASES',
  'NUTRITION',
  'OTHER',
];

const inList = (values: string[]): string => values.map((v) => `'${v}'`).join(', ');

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('consultations', (t) => {
    t.text('animal_type').nullable();
  });
  await knex.raw(
    `ALTER TABLE consultations ADD CONSTRAINT chk_consultations_animal_type CHECK (animal_type IS NULL OR animal_type IN (${inList(ANIMAL_TYPES)}))`,
  );

  await knex.schema.alterTable('inquiries', (t) => {
    t.text('category').nullable();
  });
  await knex.raw(
    `ALTER TABLE inquiries ADD CONSTRAINT chk_inquiries_category CHECK (category IS NULL OR category IN (${inList(INQUIRY_CATEGORIES)}))`,
  );
  await knex.raw(`CREATE INDEX idx_inquiries_category ON inquiries (category)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS idx_inquiries_category`);
  await knex.raw(`ALTER TABLE inquiries DROP CONSTRAINT IF EXISTS chk_inquiries_category`);
  await knex.schema.alterTable('inquiries', (t) => {
    t.dropColumn('category');
  });
  await knex.raw(`ALTER TABLE consultations DROP CONSTRAINT IF EXISTS chk_consultations_animal_type`);
  await knex.schema.alterTable('consultations', (t) => {
    t.dropColumn('animal_type');
  });
}
