import type { Knex } from 'knex';
import type { AnimalStatus } from '../domain/animal.constants.js';
import {
  rowToAnimal,
  type Animal,
  type AnimalRow,
  type ListAdminAnimalsFilter,
  type ListAnimalsFilter,
} from '../domain/animal.types.js';

const TABLE = 'animals';

export interface CreateAnimalData {
  name: string;
  species: string;
  breed: string | null;
  sex: string;
  dateOfBirth: string | null;
  notes: string | null;
  createdBy: string;
  color?: string | null;
  distinguishingFeatures?: string | null;
  ageEstimate?: string | null;
}

export interface UpdateAnimalData {
  name?: string;
  species?: string;
  breed?: string | null;
  sex?: string;
  dateOfBirth?: string | null;
  notes?: string | null;
  color?: string | null;
  distinguishingFeatures?: string | null;
  ageEstimate?: string | null;
  /** Full replacement of the gallery array — the service reads-modifies-writes. */
  galleryKeys?: string[];
}

export class AnimalRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<Animal | null> {
    const row = await this.conn(trx)<AnimalRow>(TABLE).where({ id }).first();
    return row ? rowToAnimal(row) : null;
  }

  async create(data: CreateAnimalData, trx: Knex.Transaction): Promise<Animal> {
    const [row] = (await trx(TABLE)
      .insert({
        name: data.name,
        species: data.species,
        breed: data.breed,
        sex: data.sex,
        date_of_birth: data.dateOfBirth,
        notes: data.notes,
        created_by: data.createdBy,
        status: 'ACTIVE',
        color: data.color ?? null,
        distinguishing_features: data.distinguishingFeatures ?? null,
        age_estimate: data.ageEstimate ?? null,
      })
      .returning('*')) as AnimalRow[];
    if (!row) throw new Error('animal insert did not return a row');
    return rowToAnimal(row);
  }

  async update(id: string, patch: UpdateAnimalData, trx: Knex.Transaction): Promise<Animal> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.species !== undefined) dbPatch.species = patch.species;
    if (patch.breed !== undefined) dbPatch.breed = patch.breed;
    if (patch.sex !== undefined) dbPatch.sex = patch.sex;
    if (patch.dateOfBirth !== undefined) dbPatch.date_of_birth = patch.dateOfBirth;
    if (patch.notes !== undefined) dbPatch.notes = patch.notes;
    if (patch.color !== undefined) dbPatch.color = patch.color;
    if (patch.distinguishingFeatures !== undefined)
      dbPatch.distinguishing_features = patch.distinguishingFeatures;
    if (patch.ageEstimate !== undefined) dbPatch.age_estimate = patch.ageEstimate;
    if (patch.galleryKeys !== undefined) dbPatch.gallery_keys = patch.galleryKeys;

    const [row] = (await trx(TABLE).where({ id }).update(dbPatch).returning('*')) as AnimalRow[];
    if (!row) throw new Error('animal not found after update');
    return rowToAnimal(row);
  }

  async setStatus(id: string, status: AnimalStatus, trx: Knex.Transaction): Promise<Animal> {
    const [row] = (await trx(TABLE)
      .where({ id })
      .update({
        status,
        deactivated_at: status === 'DEACTIVATED' ? new Date() : null,
        updated_at: new Date(),
      })
      .returning('*')) as AnimalRow[];
    if (!row) throw new Error('animal not found after status change');
    return rowToAnimal(row);
  }

  /** Animals whose CURRENT owner is `userId`. */
  async listForOwner(
    userId: string,
    filter: ListAnimalsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: Animal[]; total: number }> {
    const apply = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      qb.join('animal_ownerships as o', function joinCurrent() {
        this.on('o.animal_id', 'a.id').andOnNull('o.ended_at');
      }).where('o.owner_user_id', userId);
      if (filter.status) qb.where('a.status', filter.status);
      if (filter.species) qb.where('a.species', filter.species);
      if (filter.search) {
        qb.whereRaw('lower(a.name) like ?', [`%${filter.search.toLowerCase()}%`]);
      }
      return qb;
    };

    const countRow = await apply(this.conn(trx)(`${TABLE} as a`))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows: AnimalRow[] = await apply(this.conn(trx)(`${TABLE} as a`))
      .orderBy('a.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)
      .select('a.*');

    return { items: rows.map(rowToAnimal), total };
  }

  /**
   * Every user's animals (admin / ANIMAL-supervisor oversight). Joins the
   * CURRENT owner (`animal_ownerships.ended_at IS NULL`) + the owner's name.
   * Never owner-scoped — `filter.ownerUserId` is an optional narrowing.
   */
  async listForAdmin(
    filter: ListAdminAnimalsFilter,
    trx?: Knex.Transaction,
  ): Promise<{
    items: { animal: Animal; ownerUserId: string | null; ownerName: string | null }[];
    total: number;
  }> {
    const apply = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      qb.leftJoin('animal_ownerships as o', function joinCurrent() {
        this.on('o.animal_id', 'a.id').andOnNull('o.ended_at');
      }).leftJoin('users as u', 'u.id', 'o.owner_user_id');
      if (filter.ownerUserId) qb.where('o.owner_user_id', filter.ownerUserId);
      if (filter.status) qb.where('a.status', filter.status);
      if (filter.species) qb.where('a.species', filter.species);
      if (filter.search) {
        qb.whereRaw('lower(a.name) like ?', [`%${filter.search.toLowerCase()}%`]);
      }
      return qb;
    };

    const countRow = await apply(this.conn(trx)(`${TABLE} as a`))
      .count<{ count: string }>({ count: '*' })
      .first();
    const total = Number(countRow?.count ?? 0);

    const rows: (AnimalRow & {
      owner_user_id: string | null;
      owner_first_name: string | null;
      owner_last_name: string | null;
    })[] = await apply(this.conn(trx)(`${TABLE} as a`))
      .orderBy('a.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)
      .select(
        'a.*',
        'o.owner_user_id as owner_user_id',
        'u.first_name as owner_first_name',
        'u.last_name as owner_last_name',
      );

    return {
      items: rows.map((r) => ({
        animal: rowToAnimal(r),
        ownerUserId: r.owner_user_id,
        ownerName: [r.owner_first_name, r.owner_last_name].filter(Boolean).join(' ').trim() || null,
      })),
      total,
    };
  }
}
