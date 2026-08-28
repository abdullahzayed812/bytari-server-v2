import type { Knex } from 'knex';
import type { AnimalSpecies } from '../domain/animal.constants.js';
import {
  rowToPublication,
  type AnimalPublication,
  type AnimalPublicationRow,
  type AnimalPublicationWithAnimal,
  type ListPublicationsFilter,
  type PublicListFilter,
} from '../domain/publication.types.js';

const TABLE = 'animal_publications';

export interface CreatePublicationData {
  animalId: string;
  kind: string;
  note: string | null;
  createdByUserId: string;
}

export interface ReviewPublicationData {
  status: 'APPROVED' | 'REJECTED';
  reviewedByUserId: string;
  rejectionReason: string | null;
}

interface JoinedRow extends AnimalPublicationRow {
  a_id: string;
  a_name: string;
  a_species: string;
  a_breed: string | null;
}

function toWithAnimal(row: JoinedRow): AnimalPublicationWithAnimal {
  return {
    ...rowToPublication(row),
    animal: {
      id: row.a_id,
      name: row.a_name,
      species: row.a_species as AnimalSpecies,
      breed: row.a_breed,
    },
  };
}

export class AnimalPublicationRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<AnimalPublication | null> {
    const row = await this.conn(trx)<AnimalPublicationRow>(TABLE).where({ id }).first();
    return row ? rowToPublication(row) : null;
  }

  /** A publication that MUST belong to this animal (owner-scoped read guard). */
  async findByIdForAnimal(
    id: string,
    animalId: string,
    trx?: Knex.Transaction,
  ): Promise<AnimalPublication | null> {
    const row = await this.conn(trx)<AnimalPublicationRow>(TABLE)
      .where({ id, animal_id: animalId })
      .first();
    return row ? rowToPublication(row) : null;
  }

  /** An open (PENDING) publication of `kind` for `animalId`, if any. */
  async findOpen(
    animalId: string,
    kind: string,
    trx?: Knex.Transaction,
  ): Promise<AnimalPublication | null> {
    const row = await this.conn(trx)<AnimalPublicationRow>(TABLE)
      .where({ animal_id: animalId, kind, status: 'PENDING' })
      .first();
    return row ? rowToPublication(row) : null;
  }

  async create(data: CreatePublicationData, trx: Knex.Transaction): Promise<AnimalPublication> {
    const [row] = (await trx(TABLE)
      .insert({
        animal_id: data.animalId,
        kind: data.kind,
        note: data.note,
        created_by_user_id: data.createdByUserId,
      })
      .returning('*')) as AnimalPublicationRow[];
    if (!row) throw new Error('publication insert did not return a row');
    return rowToPublication(row);
  }

  async review(
    id: string,
    data: ReviewPublicationData,
    trx: Knex.Transaction,
  ): Promise<AnimalPublication> {
    const [row] = (await trx(TABLE)
      .where({ id })
      .update({
        status: data.status,
        reviewed_by_user_id: data.reviewedByUserId,
        reviewed_at: new Date(),
        rejection_reason: data.status === 'REJECTED' ? data.rejectionReason : null,
        updated_at: new Date(),
      })
      .returning('*')) as AnimalPublicationRow[];
    if (!row) throw new Error('publication not found after review');
    return rowToPublication(row);
  }

  async deleteById(id: string, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE).where({ id }).del();
  }

  /** All publications for one animal (owner / admin view), newest first. */
  async listForAnimal(
    animalId: string,
    filter: { page: number; pageSize: number },
    trx?: Knex.Transaction,
  ): Promise<{ items: AnimalPublication[]; total: number }> {
    const base = (): Knex.QueryBuilder =>
      this.conn(trx)<AnimalPublicationRow>(TABLE).where('animal_id', animalId);

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: AnimalPublicationRow[] = await base()
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToPublication), total };
  }

  /** Moderation listing (admin / animal supervisor). Filter by kind / status. */
  async listForModeration(
    filter: ListPublicationsFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: AnimalPublication[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)<AnimalPublicationRow>(TABLE);
      if (filter.kind) qb.where('kind', filter.kind);
      if (filter.status) qb.where('status', filter.status);
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: AnimalPublicationRow[] = await base()
      .orderBy('created_at', 'asc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);

    return { items: rows.map(rowToPublication), total };
  }

  /** Public browse — APPROVED publications only, joined with a non-PII animal summary. */
  async listPublicApproved(
    filter: PublicListFilter,
    trx?: Knex.Transaction,
  ): Promise<{ items: AnimalPublicationWithAnimal[]; total: number }> {
    const base = (): Knex.QueryBuilder => {
      const qb = this.conn(trx)(`${TABLE} as p`)
        .join('animals as a', 'a.id', 'p.animal_id')
        .where('p.status', 'APPROVED');
      if (filter.kind) qb.andWhere('p.kind', filter.kind);
      return qb;
    };

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);

    const rows: JoinedRow[] = await base()
      .orderBy('p.reviewed_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)
      .select(
        'p.*',
        'a.id as a_id',
        'a.name as a_name',
        'a.species as a_species',
        'a.breed as a_breed',
      );

    return { items: rows.map(toWithAnimal), total };
  }

  /** One APPROVED publication for public detail, joined with the animal summary. */
  async findPublicApprovedById(
    id: string,
    trx?: Knex.Transaction,
  ): Promise<AnimalPublicationWithAnimal | null> {
    const row: JoinedRow | undefined = await this.conn(trx)(`${TABLE} as p`)
      .join('animals as a', 'a.id', 'p.animal_id')
      .where({ 'p.id': id, 'p.status': 'APPROVED' })
      .select(
        'p.*',
        'a.id as a_id',
        'a.name as a_name',
        'a.species as a_species',
        'a.breed as a_breed',
      )
      .first();
    return row ? toWithAnimal(row) : null;
  }
}
