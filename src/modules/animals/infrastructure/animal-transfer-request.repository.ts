import type { Knex } from 'knex';
import {
  rowToTransferRequest,
  type AnimalTransferRequest,
  type AnimalTransferRequestDTO,
  type TransferRequestRow,
  type TransferRequestStatus,
} from '../domain/transfer-request.types.js';

const TABLE = 'animal_transfer_requests';

interface JoinedRow extends TransferRequestRow {
  a_id: string;
  a_name: string;
  a_species: string;
  a_breed: string | null;
  from_first_name: string;
  from_last_name: string;
  to_first_name: string;
  to_last_name: string;
}

const JOIN_COLUMNS = [
  'a.id as a_id',
  'a.name as a_name',
  'a.species as a_species',
  'a.breed as a_breed',
  'fu.first_name as from_first_name',
  'fu.last_name as from_last_name',
  'tu.first_name as to_first_name',
  'tu.last_name as to_last_name',
];

function toDTO(row: JoinedRow): AnimalTransferRequestDTO {
  const base = rowToTransferRequest(row);
  return {
    id: base.id,
    animal: { id: row.a_id, name: row.a_name, species: row.a_species, breed: row.a_breed },
    fromUser: {
      id: base.fromUserId,
      firstName: row.from_first_name,
      lastName: row.from_last_name,
    },
    toUser: { id: base.toUserId, firstName: row.to_first_name, lastName: row.to_last_name },
    status: base.status,
    reason: base.reason,
    responseReason: base.responseReason,
    respondedAt: base.respondedAt,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
  };
}

export interface CreateTransferRequestData {
  animalId: string;
  fromUserId: string;
  toUserId: string;
  reason: string | null;
}

export class AnimalTransferRequestRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  private joined(trx?: Knex.Transaction): Knex.QueryBuilder {
    return this.conn(trx)(`${TABLE} as t`)
      .join('animals as a', 'a.id', 't.animal_id')
      .join('users as fu', 'fu.id', 't.from_user_id')
      .join('users as tu', 'tu.id', 't.to_user_id');
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<AnimalTransferRequest | null> {
    const row = await this.conn(trx)<TransferRequestRow>(TABLE).where({ id }).first();
    return row ? rowToTransferRequest(row) : null;
  }

  async findDTOById(id: string, trx?: Knex.Transaction): Promise<AnimalTransferRequestDTO | null> {
    const row: JoinedRow | undefined = await this.joined(trx)
      .where('t.id', id)
      .select('t.*', ...JOIN_COLUMNS)
      .first();
    return row ? toDTO(row) : null;
  }

  /** The open (PENDING) request for an animal, if any — enforces one-at-a-time. */
  async findOpenForAnimal(
    animalId: string,
    trx?: Knex.Transaction,
  ): Promise<AnimalTransferRequest | null> {
    const row = await this.conn(trx)<TransferRequestRow>(TABLE)
      .where({ animal_id: animalId, status: 'PENDING' })
      .first();
    return row ? rowToTransferRequest(row) : null;
  }

  async create(
    data: CreateTransferRequestData,
    trx?: Knex.Transaction,
  ): Promise<AnimalTransferRequest> {
    const [row] = (await this.conn(trx)(TABLE)
      .insert({
        animal_id: data.animalId,
        from_user_id: data.fromUserId,
        to_user_id: data.toUserId,
        reason: data.reason,
      })
      .returning('*')) as TransferRequestRow[];
    if (!row) throw new Error('transfer request insert did not return a row');
    return rowToTransferRequest(row);
  }

  /**
   * Move a PENDING request to a terminal status. Returns `null` if it was no
   * longer PENDING (concurrency guard — mirrors the publication review flow).
   */
  async resolve(
    id: string,
    status: Exclude<TransferRequestStatus, 'PENDING'>,
    responseReason: string | null,
    trx?: Knex.Transaction,
  ): Promise<AnimalTransferRequest | null> {
    const [row] = (await this.conn(trx)(TABLE)
      .where({ id, status: 'PENDING' })
      .update({
        status,
        response_reason: responseReason,
        responded_at: new Date(),
        updated_at: new Date(),
      })
      .returning('*')) as TransferRequestRow[];
    return row ? rowToTransferRequest(row) : null;
  }

  async listSent(
    userId: string,
    filter: { page: number; pageSize: number },
    trx?: Knex.Transaction,
  ): Promise<{ items: AnimalTransferRequestDTO[]; total: number }> {
    return this.listBy('t.from_user_id', userId, filter, trx);
  }

  async listReceived(
    userId: string,
    filter: { page: number; pageSize: number },
    trx?: Knex.Transaction,
  ): Promise<{ items: AnimalTransferRequestDTO[]; total: number }> {
    return this.listBy('t.to_user_id', userId, filter, trx);
  }

  private async listBy(
    column: string,
    userId: string,
    filter: { page: number; pageSize: number },
    trx?: Knex.Transaction,
  ): Promise<{ items: AnimalTransferRequestDTO[]; total: number }> {
    const base = (): Knex.QueryBuilder => this.joined(trx).where(column, userId);

    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows: JoinedRow[] = await base()
      .orderBy('t.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)
      .select('t.*', ...JOIN_COLUMNS);

    return { items: rows.map(toDTO), total };
  }
}
