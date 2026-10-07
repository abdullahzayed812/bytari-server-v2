import type { Knex } from 'knex';
import {
  rowToClinicAnimalAccess,
  type ClinicAnimalAccess,
  type ClinicAnimalAccessRow,
} from '../domain/veterinary-care.types.js';

const TABLE = 'animal_clinic_access';

export interface GrantAccessData {
  animalId: string;
  organizationId: string;
  grantedByUserId: string;
}

export interface ClinicAnimalListItem {
  access: ClinicAnimalAccess;
  animalName: string;
  animalSpecies: string;
  animalStatus: string;
  animalBreed: string | null;
  ownerName: string | null;
  /** First gallery photo key (resolved to a URL by the service), or `null`. */
  animalPhotoKey: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A UUID prefix as printed on cards (`#a1b2c3d4`) — hex only, ≥ 6 chars. */
const SHORT_ID_RE = /^[0-9a-f]{6,8}$/i;

export class AnimalClinicAccessRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  /** The ACTIVE access grant for (animal, clinic), or `null`. */
  async findActive(
    animalId: string,
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<ClinicAnimalAccess | null> {
    const row = await this.conn(trx)<ClinicAnimalAccessRow>(TABLE)
      .where({ animal_id: animalId, organization_id: organizationId, status: 'ACTIVE' })
      .first();
    return row ? rowToClinicAnimalAccess(row) : null;
  }

  /** True when the clinic currently holds ACTIVE veterinary access to the animal. */
  async hasActiveAccess(
    animalId: string,
    organizationId: string,
    trx?: Knex.Transaction,
  ): Promise<boolean> {
    const row = await this.conn(trx)<ClinicAnimalAccessRow>(TABLE)
      .where({ animal_id: animalId, organization_id: organizationId, status: 'ACTIVE' })
      .select('id')
      .first();
    return row !== undefined;
  }

  async grant(data: GrantAccessData, trx: Knex.Transaction): Promise<ClinicAnimalAccess> {
    const [row] = (await trx(TABLE)
      .insert({
        animal_id: data.animalId,
        organization_id: data.organizationId,
        status: 'ACTIVE',
        granted_by_user_id: data.grantedByUserId,
      })
      .returning('*')) as ClinicAnimalAccessRow[];
    if (!row) throw new Error('clinic access insert did not return a row');
    return rowToClinicAnimalAccess(row);
  }

  /**
   * Close the ACTIVE grant for (animal, clinic). Returns the number of rows
   * affected — `0` means there was nothing active (concurrency / idempotency
   * guard for the caller).
   */
  async revokeActive(
    animalId: string,
    organizationId: string,
    revokedByUserId: string,
    trx: Knex.Transaction,
  ): Promise<number> {
    return trx(TABLE)
      .where({ animal_id: animalId, organization_id: organizationId, status: 'ACTIVE' })
      .update({
        status: 'REVOKED',
        revoked_by_user_id: revokedByUserId,
        revoked_at: new Date(),
        updated_at: new Date(),
      });
  }

  /** ACTIVE grants for a clinic, with a small animal summary, newest first. */
  async listActiveForClinic(
    organizationId: string,
    filter: { page: number; pageSize: number; search?: string },
    trx?: Knex.Transaction,
  ): Promise<{ items: ClinicAnimalListItem[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)(`${TABLE} as ac`)
        .join('animals as a', 'a.id', 'ac.animal_id')
        .leftJoin('animal_ownerships as ow', function joinOwner() {
          this.on('ow.animal_id', '=', 'ac.animal_id').andOnNull('ow.ended_at');
        })
        .leftJoin('users as u', 'u.id', 'ow.owner_user_id')
        .where('ac.organization_id', organizationId)
        .andWhere('ac.status', 'ACTIVE')
        .andWhere('a.listing_only', false);
      const term = filter.search?.trim();
      if (term) {
        if (UUID_RE.test(term)) {
          qb.andWhere('a.id', term);
        } else {
          const like = `%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
          qb.andWhere((w) => {
            void w
              .whereILike('a.name', like)
              .orWhereILike('a.breed', like)
              .orWhereILike('a.species', like)
              .orWhereRaw(`(u.first_name || ' ' || u.last_name) ILIKE ?`, [like])
              .orWhereILike('u.phone', like);
            // The short identifier shown on cards / Pet Details (UUID prefix).
            if (SHORT_ID_RE.test(term)) void w.orWhereRaw('a.id::text ILIKE ?', [`${term}%`]);
          });
        }
      }
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows: Array<
      ClinicAnimalAccessRow & {
        a_name: string;
        a_species: string;
        a_status: string;
        a_breed: string | null;
        u_first_name: string | null;
        u_last_name: string | null;
        a_gallery_keys: string[] | null;
      }
    > = await base()
      .orderBy('ac.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)
      .select(
        'ac.*',
        'a.name as a_name',
        'a.species as a_species',
        'a.status as a_status',
        'a.breed as a_breed',
        'u.first_name as u_first_name',
        'u.last_name as u_last_name',
        'a.gallery_keys as a_gallery_keys',
      );

    return {
      items: rows.map((row) => ({
        access: rowToClinicAnimalAccess(row),
        animalName: row.a_name,
        animalSpecies: row.a_species,
        animalStatus: row.a_status,
        animalBreed: row.a_breed,
        ownerName: row.u_first_name ? `${row.u_first_name} ${row.u_last_name ?? ''}`.trim() : null,
        animalPhotoKey: row.a_gallery_keys?.[0] ?? null,
      })),
      total,
    };
  }
}
