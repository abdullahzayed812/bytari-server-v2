import type { Knex } from 'knex';
import {
  rowToOwnership,
  type AnimalOwnership,
  type AnimalOwnershipRow,
  type OwnershipRecordDTO,
  type UserSummary,
} from '../domain/animal.types.js';

const TABLE = 'animal_ownerships';

interface JoinedRow extends AnimalOwnershipRow {
  u_email: string;
  u_first_name: string;
  u_last_name: string;
}

export class AnimalOwnershipRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  /** The current (open) ownership for an animal, or `null`. */
  async findCurrent(animalId: string, trx?: Knex.Transaction): Promise<AnimalOwnership | null> {
    const row = await this.conn(trx)<AnimalOwnershipRow>(TABLE)
      .where({ animal_id: animalId })
      .whereNull('ended_at')
      .first();
    return row ? rowToOwnership(row) : null;
  }

  /** Current owner user id for an animal (or `null` if none / unknown animal). */
  async currentOwnerUserId(animalId: string, trx?: Knex.Transaction): Promise<string | null> {
    const row = await this.conn(trx)<AnimalOwnershipRow>(TABLE)
      .where({ animal_id: animalId })
      .whereNull('ended_at')
      .select('owner_user_id')
      .first();
    return row ? row.owner_user_id : null;
  }

  /** `animalId -> currentOwnerUserId` for a set of animals. */
  async currentOwnerMap(animalIds: string[], trx?: Knex.Transaction): Promise<Map<string, string>> {
    if (animalIds.length === 0) return new Map();
    const rows: Array<{ animal_id: string; owner_user_id: string }> = await this.conn(
      trx,
    )<AnimalOwnershipRow>(TABLE)
      .whereIn('animal_id', animalIds)
      .whereNull('ended_at')
      .select('animal_id', 'owner_user_id');
    return new Map(rows.map((r) => [r.animal_id, r.owner_user_id]));
  }

  async create(
    data: {
      animalId: string;
      ownerUserId: string;
      transferredBy: string | null;
      transferReason: string | null;
      startedAt?: Date;
    },
    trx: Knex.Transaction,
  ): Promise<AnimalOwnership> {
    const [row] = (await trx(TABLE)
      .insert({
        animal_id: data.animalId,
        owner_user_id: data.ownerUserId,
        transferred_by: data.transferredBy,
        transfer_reason: data.transferReason,
        ...(data.startedAt ? { started_at: data.startedAt } : {}),
      })
      .returning('*')) as AnimalOwnershipRow[];
    if (!row) throw new Error('ownership insert did not return a row');
    return rowToOwnership(row);
  }

  /**
   * Close the current ownership for an animal. Returns the number of rows
   * affected — `0` means there was no open ownership (used as a concurrency
   * guard by the transfer use-case).
   */
  async endCurrent(animalId: string, endedAt: Date, trx: Knex.Transaction): Promise<number> {
    return trx(TABLE)
      .where({ animal_id: animalId })
      .whereNull('ended_at')
      .update({ ended_at: endedAt });
  }

  /** Full ownership history for an animal, oldest first, with the owner's summary. */
  async listForAnimal(animalId: string, trx?: Knex.Transaction): Promise<OwnershipRecordDTO[]> {
    const rows: JoinedRow[] = await this.conn(trx)(`${TABLE} as o`)
      .join('users as u', 'u.id', 'o.owner_user_id')
      .where('o.animal_id', animalId)
      .orderBy('o.started_at', 'asc')
      .select(
        'o.*',
        'u.email as u_email',
        'u.first_name as u_first_name',
        'u.last_name as u_last_name',
      );

    return rows.map((row) => {
      const owner: UserSummary = {
        id: row.owner_user_id,
        email: row.u_email,
        firstName: row.u_first_name,
        lastName: row.u_last_name,
      };
      const base = rowToOwnership(row);
      return {
        id: base.id,
        animalId: base.animalId,
        ownerUserId: base.ownerUserId,
        owner,
        startedAt: base.startedAt,
        endedAt: base.endedAt,
        isCurrent: base.endedAt === null,
        transferredBy: base.transferredBy,
        transferReason: base.transferReason,
      };
    });
  }
}
