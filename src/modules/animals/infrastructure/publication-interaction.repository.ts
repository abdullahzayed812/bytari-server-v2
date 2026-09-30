import type { Knex } from 'knex';
import type {
  PublicationKind,
  PublicationResolution,
  PublicationStatus,
} from '../domain/publication.constants.js';
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

  async setConversation(
    id: string,
    conversationId: string,
    trx?: Knex.Transaction,
  ): Promise<PublicationInteraction> {
    const [row] = (await this.conn(trx)(TABLE)
      .where({ id })
      .update({ conversation_id: conversationId })
      .returning('*')) as InteractionRow[];
    if (!row) throw new Error('publication interaction vanished');
    return rowToInteraction(row);
  }

  /** Every request / report on one listing, newest first, with the requester's name. */
  async listForPublication(
    publicationId: string,
    trx?: Knex.Transaction,
  ): Promise<
    Array<
      PublicationInteraction & {
        requester: { id: string; firstName: string; lastName: string; avatarKey: string | null };
      }
    >
  > {
    const rows: Array<
      InteractionRow & {
        requester_first_name: string;
        requester_last_name: string;
        requester_avatar_key: string | null;
      }
    > = await this.conn(trx)(`${TABLE} as i`)
      .join('users as u', 'u.id', 'i.requester_user_id')
      .where('i.publication_id', publicationId)
      .orderBy('i.created_at', 'desc')
      .select(
        'i.*',
        'u.first_name as requester_first_name',
        'u.last_name as requester_last_name',
        'u.avatar_key as requester_avatar_key',
      );
    return rows.map((r) => ({
      ...rowToInteraction(r),
      requester: {
        id: r.requester_user_id,
        firstName: r.requester_first_name,
        lastName: r.requester_last_name,
        avatarKey: r.requester_avatar_key,
      },
    }));
  }

  /** The caller's own requests / reports with each listing's current state. */
  async listMine(
    requesterUserId: string,
    filter: { page: number; pageSize: number; kind?: PublicationKind },
    trx?: Knex.Transaction,
  ): Promise<{
    items: Array<
      PublicationInteraction & {
        publication: {
          id: string;
          kind: PublicationKind;
          status: PublicationStatus;
          resolution: PublicationResolution | null;
          animalName: string;
        };
      }
    >;
    total: number;
  }> {
    const base = (): Knex.QueryBuilder =>
      this.conn(trx)(`${TABLE} as i`)
        .join('animal_publications as p', 'p.id', 'i.publication_id')
        .join('animals as a', 'a.id', 'p.animal_id')
        .where('i.requester_user_id', requesterUserId)
        .modify((qb) => {
          if (filter.kind) qb.andWhere('p.kind', filter.kind);
        });
    const countRow = await base().count<{ count: string }>({ count: '*' }).first();
    const rows: Array<
      InteractionRow & {
        publication_kind: string;
        publication_status: string;
        publication_resolution: string | null;
        animal_name: string;
      }
    > = await base()
      .orderBy('i.created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)
      .select(
        'i.*',
        'p.kind as publication_kind',
        'p.status as publication_status',
        'p.resolution as publication_resolution',
        'a.name as animal_name',
      );
    return {
      items: rows.map((r) => ({
        ...rowToInteraction(r),
        publication: {
          id: r.publication_id,
          kind: r.publication_kind as PublicationKind,
          status: r.publication_status as PublicationStatus,
          resolution: (r.publication_resolution as PublicationResolution | null) ?? null,
          animalName: r.animal_name,
        },
      })),
      total: Number(countRow?.count ?? 0),
    };
  }
}
