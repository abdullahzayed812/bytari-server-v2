import type { Knex } from 'knex';

/**
 * Clinic record isolation + short public pet identifier.
 *
 * 1. `animals.public_code` — the human-facing pet ID (shown on Pet Details,
 *    encoded in the QR, typed / dictated at a clinic). 7 characters from a
 *    30-symbol alphabet without look-alikes (no 0/O, 1/I/L, U), ≈ 2.2·10¹⁰
 *    codes. Drawn from `gen_random_uuid()` bytes (CSPRNG) with rejection
 *    sampling, so codes are uniform, non-sequential and reveal nothing about
 *    record counts. Assigned by a BEFORE INSERT trigger (every insert path —
 *    API, seeds, tests — gets one) and backfilled for existing animals; the
 *    UUID primary key is untouched, so every existing URL / QR (which encode
 *    the UUID) keeps resolving.
 *
 * 2. Indexes for the clinic "worked-with pets" read model (Recent / All Pets),
 *    now derived from the clinic's OWN records instead of an access grant:
 *    `(organization_id, animal_id, created_at)` on the three clinic-authored
 *    tables. `animal_clinic_access` is left in place (no data is dropped) but
 *    is no longer read or written.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 7;

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION generate_animal_public_code() RETURNS text
    LANGUAGE plpgsql VOLATILE AS $$
    DECLARE
      alphabet constant text := '${ALPHABET}';
      n constant int := ${ALPHABET.length};
      -- largest multiple of n that fits in a byte: bytes >= it are rejected (no modulo bias)
      cutoff constant int := (256 / n) * n;
      code text;
      bytes bytea;
      b int;
      i int;
    BEGIN
      LOOP
        code := '';
        WHILE length(code) < ${CODE_LENGTH} LOOP
          bytes := uuid_send(gen_random_uuid());
          FOR i IN 0..15 LOOP
            -- skip the UUID version / variant bytes (not uniformly random)
            CONTINUE WHEN i = 6 OR i = 8;
            b := get_byte(bytes, i);
            CONTINUE WHEN b >= cutoff;
            code := code || substr(alphabet, (b % n) + 1, 1);
            EXIT WHEN length(code) = ${CODE_LENGTH};
          END LOOP;
        END LOOP;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM animals WHERE public_code = code);
      END LOOP;
      RETURN code;
    END;
    $$
  `);

  await knex.schema.alterTable('animals', (t) => {
    t.text('public_code').nullable();
  });
  await knex.raw(`CREATE UNIQUE INDEX uq_animals_public_code ON animals (public_code)`);

  // Backfill row by row; a (practically impossible) collision just retries.
  await knex.raw(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT id FROM animals WHERE public_code IS NULL LOOP
        LOOP
          BEGIN
            UPDATE animals SET public_code = generate_animal_public_code() WHERE id = r.id;
            EXIT;
          EXCEPTION WHEN unique_violation THEN
            -- retry with a fresh code
          END;
        END LOOP;
      END LOOP;
    END $$
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION animals_assign_public_code() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.public_code IS NULL THEN
        NEW.public_code := generate_animal_public_code();
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await knex.raw(`
    CREATE TRIGGER trg_animals_public_code
      BEFORE INSERT ON animals
      FOR EACH ROW EXECUTE FUNCTION animals_assign_public_code()
  `);
  await knex.raw(`ALTER TABLE animals ALTER COLUMN public_code SET NOT NULL`);
  await knex.raw(`
    ALTER TABLE animals
      ADD CONSTRAINT chk_animals_public_code CHECK (public_code ~ '^[${ALPHABET}]{${CODE_LENGTH}}$')
  `);

  // --- clinic worked-with read model ---------------------------------
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_medical_records_org_animal_created
      ON medical_records (organization_id, animal_id, created_at)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_vaccinations_org_animal_created
      ON vaccinations (organization_id, animal_id, created_at)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_animal_reminders_org_animal_created
      ON animal_reminders (organization_id, animal_id, created_at)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_animal_reminders_org_animal_created');
  await knex.raw('DROP INDEX IF EXISTS idx_vaccinations_org_animal_created');
  await knex.raw('DROP INDEX IF EXISTS idx_medical_records_org_animal_created');
  await knex.raw('DROP TRIGGER IF EXISTS trg_animals_public_code ON animals');
  await knex.raw('DROP FUNCTION IF EXISTS animals_assign_public_code()');
  await knex.raw('ALTER TABLE animals DROP CONSTRAINT IF EXISTS chk_animals_public_code');
  await knex.raw('DROP INDEX IF EXISTS uq_animals_public_code');
  await knex.schema.alterTable('animals', (t) => {
    t.dropColumn('public_code');
  });
  await knex.raw('DROP FUNCTION IF EXISTS generate_animal_public_code()');
}
