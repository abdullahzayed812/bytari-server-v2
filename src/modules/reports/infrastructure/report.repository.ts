import type { Knex } from 'knex';
import { offset } from '../../../shared/http/pagination.js';
import type {
  ContentReport,
  ContentReportRow,
  ListReportsFilter,
  ReportStatus,
  SubmitReportInput,
} from '../domain/report.types.js';

function toDTO(row: ContentReportRow): ContentReport {
  return {
    id: row.id,
    reporterUserId: row.reporter_user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    details: row.details,
    status: row.status,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class ReportRepository {
  constructor(private readonly db: Knex) {}

  async create(reporterUserId: string, input: SubmitReportInput): Promise<ContentReport> {
    const [row]: ContentReportRow[] = await this.db<ContentReportRow>('content_reports')
      .insert({
        reporter_user_id: reporterUserId,
        target_type: input.targetType,
        target_id: input.targetId,
        reason: input.reason,
        details: input.details ?? null,
      })
      .returning('*');
    if (!row) throw new Error('content_reports insert did not return a row');
    return toDTO(row);
  }

  async findById(id: string): Promise<ContentReport | null> {
    const row = await this.db<ContentReportRow>('content_reports').where({ id }).first();
    return row ? toDTO(row) : null;
  }

  async list(filter: ListReportsFilter): Promise<{ items: ContentReport[]; total: number }> {
    let query = this.db<ContentReportRow>('content_reports');
    if (filter.status) query = query.where({ status: filter.status });
    if (filter.targetType) query = query.where({ target_type: filter.targetType });

    const [rows, countRow] = await Promise.all([
      query
        .clone()
        .orderBy('created_at', 'desc')
        .limit(filter.pageSize)
        .offset(offset(filter.page, filter.pageSize)),
      query.clone().count<{ count: string }>({ count: '*' }).first(),
    ]);
    return { items: rows.map(toDTO), total: Number(countRow?.count ?? 0) };
  }

  async updateStatus(
    id: string,
    status: ReportStatus,
    reviewedByUserId: string,
  ): Promise<ContentReport | null> {
    const [row] = await this.db<ContentReportRow>('content_reports')
      .where({ id })
      .update({
        status,
        reviewed_by_user_id: reviewedByUserId,
        reviewed_at: this.db.fn.now(),
        updated_at: this.db.fn.now(),
      })
      .returning('*');
    return row ? toDTO(row) : null;
  }
}
