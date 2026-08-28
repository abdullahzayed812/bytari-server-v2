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
}

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
    filter: { page: number; pageSize: number },
    trx?: Knex.Transaction,
  ): Promise<{ items: ClinicAnimalListItem[]; total: number }> {
    const base = (): Knex.QueryBuilder =>
      this.conn(trx)(`${TABLE} as ac`)
        .join('animals as a', 'a.id', 'ac.animal_id')
        .where('ac.organization_id', organizationId)
        .andWhere('ac.status', 'ACTIVE');

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows: Array<
      ClinicAnimalAccessRow & { a_name: string; a_species: string; a_status: string }
    > = await base()
      .orderBy('ac.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)
      .select('ac.*', 'a.name as a_name', 'a.species as a_species', 'a.status as a_status');

    return {
      items: rows.map((row) => ({
        access: rowToClinicAnimalAccess(row),
        animalName: row.a_name,
        animalSpecies: row.a_species,
        animalStatus: row.a_status,
      })),
      total,
    };
  }
}
