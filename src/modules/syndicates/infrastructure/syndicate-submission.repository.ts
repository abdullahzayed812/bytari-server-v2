import type { Knex } from 'knex';
import {
  rowToSubmission,
  type CreateSubmissionInput,
  type MySubmissionListFilter,
  type SubmissionListFilter,
  type SyndicateSubmission,
  type SyndicateSubmissionRow,
} from '../domain/syndicate.types.js';

const T = 'syndicate_submissions';

export class SyndicateSubmissionRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  async create(
    organizationId: string,
    submittedByUserId: string,
    input: CreateSubmissionInput,
    trx: Knex.Transaction,
  ): Promise<SyndicateSubmission> {
    const [row] = (await trx(T)
      .insert({
        organization_id: organizationId,
        kind: input.kind,
        request_type: input.requestType ?? null,
        message: input.message,
        // `attachment_keys` is a native Postgres `text[]` column (not jsonb) —
        // pass the JS array as-is; the pg driver serializes it, matching the
        // organizations module's `gallery_keys text[]` convention.
        attachment_keys: input.attachmentStorageKeys ?? [],
        submitted_by_user_id: submittedByUserId,
        status: 'PENDING',
      })
      .returning('*')) as SyndicateSubmissionRow[];
    if (!row) throw new Error('syndicate_submission insert returned no row');
    return rowToSubmission(row);
  }

  async findById(id: string, trx?: Knex.Transaction): Promise<SyndicateSubmission | null> {
    const row = await this.conn(trx)<SyndicateSubmissionRow>(T).where({ id }).first();
    return row ? rowToSubmission(row) : null;
  }

  async update(
    id: string,
    patch: Partial<{
      status: string;
      responseText: string | null;
      respondedByUserId: string | null;
      respondedAt: Date | null;
    }>,
    trx: Knex.Transaction,
  ): Promise<SyndicateSubmission> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date() };
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.responseText !== undefined) dbPatch.response_text = patch.responseText;
    if (patch.respondedByUserId !== undefined) dbPatch.responded_by_user_id = patch.respondedByUserId;
    if (patch.respondedAt !== undefined) dbPatch.responded_at = patch.respondedAt;
    const [row] = (await trx(T).where({ id }).update(dbPatch).returning('*')) as SyndicateSubmissionRow[];
    if (!row) throw new Error('syndicate_submission not found on update');
    return rowToSubmission(row);
  }

  async listForOrganization(
    organizationId: string,
    filter: SubmissionListFilter,
  ): Promise<{ items: SyndicateSubmission[]; total: number }> {
    const scope = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      qb.where('organization_id', organizationId);
      if (filter.kind) qb.andWhere('kind', filter.kind);
      if (filter.status) qb.andWhere('status', filter.status);
      return qb;
    };
    const countRow = await scope(this.conn()(T)).count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await scope(this.conn()<SyndicateSubmissionRow>(T))
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as SyndicateSubmissionRow[];
    return { items: rows.map(rowToSubmission), total };
  }

  async listMine(
    submittedByUserId: string,
    filter: MySubmissionListFilter,
  ): Promise<{ items: SyndicateSubmission[]; total: number }> {
    const scope = (qb: Knex.QueryBuilder): Knex.QueryBuilder => {
      qb.where('submitted_by_user_id', submittedByUserId);
      if (filter.kind) qb.andWhere('kind', filter.kind);
      return qb;
    };
    const countRow = await scope(this.conn()(T)).count<{ count: string }>({ count: '*' }).first();
    const total = Number(countRow?.count ?? 0);
    const rows = (await scope(this.conn()<SyndicateSubmissionRow>(T))
      .orderBy('created_at', 'desc')
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize)) as SyndicateSubmissionRow[];
    return { items: rows.map(rowToSubmission), total };
  }
}
