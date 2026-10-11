import type { Knex } from 'knex';
import { normalizePublicCode } from '../../animals/domain/public-code.js';

/**
 * A pet a clinic has worked with — derived, never stored. The relationship is
 * the clinic's OWN records for the pet (`medical_records` ∪ `vaccinations` ∪
 * `animal_reminders` with `organization_id = clinic`); there is no link /
 * grant row. A clinic that has recorded nothing for a pet does not list it.
 */
export interface ClinicPetListItem {
  animalId: string;
  publicCode: string;
  animalName: string;
  animalSpecies: string;
  animalStatus: string;
  animalBreed: string | null;
  ownerName: string | null;
  /** First gallery photo key (resolved to a URL by the service), or `null`. */
  animalPhotoKey: string | null;
  /** When this clinic first / last added or changed something for the pet. */
  firstActivityAt: string;
  lastActivityAt: string;
}

export interface ClinicPetActivity {
  firstActivityAt: string;
  lastActivityAt: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The clinic-authored tables that make up a clinic's relationship with a pet. */
const CLINIC_AUTHORED_TABLES = ['medical_records', 'vaccinations', 'animal_reminders'] as const;

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

/** Rows detached per table by {@link ClinicPetRepository.detachFromClinic}. */
export interface ClinicPetDetachCounts {
  medicalRecords: number;
  vaccinations: number;
  reminders: number;
}

export class ClinicPetRepository {
  constructor(private readonly db: Knex) {}

  /**
   * "Remove pet from this clinic": detach every row THIS clinic authored for
   * the pet (see migration `20261104020000_clinic_pet_removal`). The clinic
   * attribution moves to the server-only `removed_*` columns, so the rows
   * leave every `organization_id`-scoped clinic read (lists, counts, the pet
   * file) and owner views no longer name the clinic or the veterinarian. Other
   * clinics' rows are untouched (the WHERE is this clinic's id). Nothing is
   * deleted. Locks the rows first so concurrent removals serialise.
   */
  async detachFromClinic(
    organizationId: string,
    animalId: string,
    actorUserId: string,
    trx: Knex.Transaction,
  ): Promise<ClinicPetDetachCounts> {
    const run = async (table: (typeof CLINIC_AUTHORED_TABLES)[number]): Promise<number> => {
      await trx(table)
        .where({ organization_id: organizationId, animal_id: animalId })
        .forUpdate()
        .select('id');
      return trx(table)
        .where({ organization_id: organizationId, animal_id: animalId })
        .update({
          removed_from_organization_id: organizationId,
          removed_recorded_by_user_id: trx.raw('recorded_by_user_id'),
          removed_at: trx.fn.now(),
          removed_by_user_id: actorUserId,
          organization_id: null,
          recorded_by_user_id: null,
        });
    };
    return {
      medicalRecords: await run('medical_records'),
      vaccinations: await run('vaccinations'),
      reminders: await run('animal_reminders'),
    };
  }

  /**
   * `(animal_id, first_at, last_at)` per pet, from THIS clinic's rows only —
   * each branch is scoped by `organization_id` and served by the
   * `idx_*_org_animal_created` indexes.
   */
  private activity(organizationId: string, animalId?: string): Knex.QueryBuilder {
    const branch = (table: string) => (qb: Knex.QueryBuilder) => {
      void qb
        .select('animal_id', 'created_at', 'updated_at')
        .from(table)
        .where('organization_id', organizationId);
      if (animalId) void qb.andWhere('animal_id', animalId);
    };
    const [first, ...rest] = CLINIC_AUTHORED_TABLES;
    const union = this.db.queryBuilder();
    branch(first)(union);
    for (const t of rest) void union.unionAll(branch(t), true);
    return this.db
      .from(union.as('x'))
      .select('x.animal_id')
      .min({ first_at: 'x.created_at' })
      .max({ last_at: 'x.updated_at' })
      .groupBy('x.animal_id');
  }

  /** This clinic's activity on one pet, or `null` when it has never recorded anything. */
  async activityFor(organizationId: string, animalId: string): Promise<ClinicPetActivity | null> {
    const row = (await this.activity(organizationId, animalId).first()) as
      { first_at: Date; last_at: Date } | undefined;
    return row ? { firstActivityAt: iso(row.first_at), lastActivityAt: iso(row.last_at) } : null;
  }

  async countForClinic(organizationId: string): Promise<number> {
    const row = (await this.db
      .from(this.activity(organizationId).as('act'))
      .join('animals as a', 'a.id', 'act.animal_id')
      .where('a.listing_only', false)
      .count<{ count: string }>({ count: '*' })
      .first()) as { count?: string } | undefined;
    return Number(row?.count ?? 0);
  }

  /**
   * The clinic's worked-with pets, most recent activity first ("Recent Pets"
   * is the first page; "All Pets" pages through it). `search` matches the
   * full UUID or short public ID exactly, or name / breed / species / owner
   * name / owner phone — always within this clinic's own pets.
   */
  async listForClinic(
    organizationId: string,
    filter: { page: number; pageSize: number; search?: string },
  ): Promise<{ items: ClinicPetListItem[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.db
        .from(this.activity(organizationId).as('act'))
        .join('animals as a', 'a.id', 'act.animal_id')
        .leftJoin('animal_ownerships as ow', function joinOwner() {
          this.on('ow.animal_id', '=', 'act.animal_id').andOnNull('ow.ended_at');
        })
        .leftJoin('users as u', 'u.id', 'ow.owner_user_id')
        .where('a.listing_only', false);
      const term = filter.search?.trim();
      if (term) {
        if (UUID_RE.test(term)) {
          void qb.andWhere('a.id', term);
        } else {
          const code = normalizePublicCode(term);
          const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
          void qb.andWhere((w) => {
            void w
              .whereILike('a.name', like)
              .orWhereILike('a.breed', like)
              .orWhereILike('a.species', like)
              .orWhereRaw(`(u.first_name || ' ' || u.last_name) ILIKE ?`, [like])
              .orWhereILike('u.phone', like);
            if (code) void w.orWhere('a.public_code', code);
          });
        }
      }
      return qb;
    };

    const countRow = (await base().count<{ count: string }>({ count: '*' }).first()) as
      { count?: string } | undefined;
    const rows: Array<{
      animal_id: string;
      first_at: Date;
      last_at: Date;
      a_public_code: string;
      a_name: string;
      a_species: string;
      a_status: string;
      a_breed: string | null;
      a_gallery_keys: string[] | null;
      u_first_name: string | null;
      u_last_name: string | null;
    }> = await base()
      .select(
        'act.animal_id',
        'act.first_at',
        'act.last_at',
        'a.public_code as a_public_code',
        'a.name as a_name',
        'a.species as a_species',
        'a.status as a_status',
        'a.breed as a_breed',
        'a.gallery_keys as a_gallery_keys',
        'u.first_name as u_first_name',
        'u.last_name as u_last_name',
      )
      .orderBy([
        { column: 'act.last_at', order: 'desc' },
        { column: 'act.animal_id', order: 'asc' },
      ])
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return {
      items: rows.map((row) => ({
        animalId: row.animal_id,
        publicCode: row.a_public_code,
        animalName: row.a_name,
        animalSpecies: row.a_species,
        animalStatus: row.a_status,
        animalBreed: row.a_breed,
        ownerName: row.u_first_name ? `${row.u_first_name} ${row.u_last_name ?? ''}`.trim() : null,
        animalPhotoKey: row.a_gallery_keys?.[0] ?? null,
        firstActivityAt: iso(row.first_at),
        lastActivityAt: iso(row.last_at),
      })),
      total: Number(countRow?.count ?? 0),
    };
  }
}
