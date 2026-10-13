import type { Knex } from 'knex';

/**
 * Admin-managed images for the EXISTING bottom sections of the Pet Owner and
 * Veterinarian home pages (the cards that otherwise show a fixed icon). One
 * optional image per section key; no row = the app keeps its built-in icon.
 * The section list itself stays in code (`HOME_SECTION_KEYS`) — this table
 * only stores the image, never titles, routes or new sections.
 */
const KEYS = [
  'PET_OWNER_PETS',
  'PET_OWNER_LIVESTOCK',
  'PET_OWNER_POULTRY',
  'VET_CHAT',
  'VET_SERVICES',
  'VET_MAGAZINE',
  'VET_BOOKS',
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('home_section_images', (t) => {
    t.text('section_key').primary();
    t.text('image_key').notNullable();
    t.text('image_storage_provider').nullable();
    t.uuid('updated_by_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw(
    `ALTER TABLE home_section_images ADD CONSTRAINT chk_home_section_images_key
       CHECK (section_key IN (${KEYS.map((k) => `'${k}'`).join(', ')}))`,
  );

  await knex('permissions')
    .insert({
      key: 'home_section.manage',
      description: 'Upload, replace and remove the images of the home-page sections',
    })
    .onConflict('key')
    .ignore();
}

export async function down(knex: Knex): Promise<void> {
  await knex('permissions').where({ key: 'home_section.manage' }).del();
  await knex.schema.dropTableIfExists('home_section_images');
}
