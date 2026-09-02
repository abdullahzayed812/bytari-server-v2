import type { Knex } from 'knex';
import {
  rowToInteraction,
  type CreateInteractionInput,
  type InteractionRow,
  type PublicationInteraction,
} from '../domain/publication.types.js';

const TABLE = 'animal_publication_interactions';

/**
 * "طلب التبني" / "طلب تزاوج" / "ابلاغ عن مشاهدة" — one row per (publication,
 * requester, type). Re-tapping the same action upserts (updates the message /
 * timestamp) rather than creating a duplicate — no repeated notification spam.
 */
export class PublicationInteractionRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async upsert(
    publicationId: string,
    requesterUserId: string,
    input: CreateInteractionInput,
    trx?: Knex.Transaction,
  ): Promise<PublicationInteraction> {
    const [row] = (await this.conn(trx)(TABLE)
      .insert({
        publication_id: publicationId,
        requester_user_id: requesterUserId,
        type: input.type,
        message: input.message ?? null,
      })
      .onConflict(['publication_id', 'requester_user_id', 'type'])
      .merge({ message: input.message ?? null, created_at: new Date() })
      .returning('*')) as InteractionRow[];
    if (!row) throw new Error('publication interaction upsert did not return a row');
    return rowToInteraction(row);
  }
}
