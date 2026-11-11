import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError, ValidationError } from '../../../shared/errors/app-error.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { MessageRepository } from '../../chat/infrastructure/message.repository.js';
import type { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import type {
  AdminContentReport,
  ContentReport,
  ListReportsFilter,
  ReportStatus,
  ReportTargetType,
  SubmitReportInput,
} from '../domain/report.types.js';
import type { ReportRepository } from '../infrastructure/report.repository.js';

/** Table-backed targets: `id` must exist (and not be soft-deleted where the table supports it). */
const GENERIC_TARGETS: Partial<Record<ReportTargetType, { table: string; softDelete: boolean }>> = {
  USER: { table: 'users', softDelete: false },
  ANIMAL_PUBLICATION: { table: 'animal_publications', softDelete: false },
  ORGANIZATION: { table: 'organizations', softDelete: false },
  ORGANIZATION_REVIEW: { table: 'organization_reviews', softDelete: false },
  CONTENT_COMMENT: { table: 'content_comments', softDelete: true },
};

const PREVIEW_CHARS = 280;

const AI_MESSAGE_TABLES = ['consultation_messages', 'inquiry_messages', 'support_thread_messages'];

export interface ReportActor {
  actorUserId: string;
  context?: AuditContext;
}

/**
 * Content reporting ("الإبلاغ عن الرسالة") — any authenticated user may report
 * a message or a room; an admin (`content_report.admin.manage`) lists and
 * reviews the queue. New, self-contained (confirmed absent everywhere else
 * in the codebase) — deliberately minimal: no notification fan-out, no
 * auto-moderation action beyond what an admin/moderator already has via the
 * existing `chat_room.message.delete` / organization-suspend endpoints.
 */
export class ReportService {
  private readonly log: Logger;

  constructor(
    private readonly reports: ReportRepository,
    private readonly messages: MessageRepository,
    private readonly organizations: OrganizationRepository,
    private readonly audit: AuditService,
    logger: Logger,
    /** Resolves the generic (table-backed) targets; optional only for narrow harnesses. */
    private readonly db: Knex | null = null,
  ) {
    this.log = logger.child({ component: 'report-service' });
  }

  async submit(input: SubmitReportInput, actor: ReportActor): Promise<ContentReport> {
    if (input.targetType === 'MESSAGE') {
      const message = await this.messages.findById(input.targetId);
      if (!message || message.deletedAt) throw new NotFoundError('Message not found');
    } else if (input.targetType === 'ROOM') {
      const org = await this.organizations.findById(input.targetId);
      if (!org || org.type !== 'CHAT_ROOM') throw new NotFoundError('Room not found');
    } else if (input.targetType === 'AI_MESSAGE') {
      if (!(await this.aiMessageExists(input.targetId)))
        throw new NotFoundError('Answer not found');
    } else {
      const spec = GENERIC_TARGETS[input.targetType];
      if (!spec) throw new ValidationError('Unknown report target type');
      if (!(await this.rowExists(spec.table, input.targetId, spec.softDelete)))
        throw new NotFoundError('Reported content not found');
    }

    const report = await this.reports.create(actor.actorUserId, input);
    await this.audit.record({
      action: AuditAction.CONTENT_REPORT_SUBMITTED,
      entityType: AuditEntityType.CONTENT_REPORT,
      entityId: report.id,
      actorUserId: actor.actorUserId,
      metadata: { targetType: input.targetType, targetId: input.targetId, reason: input.reason },
      context: actor.context,
    });
    return report;
  }

  private requireDb(): Knex {
    if (!this.db) throw new Error('ReportService was built without a database handle');
    return this.db;
  }

  private async rowExists(table: string, id: string, softDelete: boolean): Promise<boolean> {
    const q = this.requireDb()<{ id: string; deleted_at: Date | null }>(table)
      .where({ id })
      .first('id');
    if (softDelete) q.whereNull('deleted_at');
    return Boolean(await q);
  }

  /** An AI answer lives in one of the three support-thread message tables. */
  private async aiMessageExists(id: string): Promise<boolean> {
    for (const table of AI_MESSAGE_TABLES) {
      const row = await this.requireDb()<{ id: string; source: string; deleted_at: Date | null }>(
        table,
      )
        .where({ id, source: 'AI' })
        .whereNull('deleted_at')
        .first('id');
      if (row) return true;
    }
    return false;
  }

  async listForAdmin(
    filter: ListReportsFilter,
  ): Promise<{ items: AdminContentReport[]; total: number }> {
    const page = await this.reports.list(filter);
    if (!this.db) {
      return {
        items: page.items.map((r) => ({
          ...r,
          target: { preview: null, authorUserId: null, exists: true },
        })),
        total: page.total,
      };
    }
    const items = await Promise.all(
      page.items.map(async (r) => ({ ...r, target: await this.describeTarget(r) })),
    );
    return { items, total: page.total };
  }

  /** One small lookup per row (page size ≤ 100) — admin-only, low volume. */
  private async describeTarget(r: ContentReport): Promise<AdminContentReport['target']> {
    const db = this.requireDb();
    const one = async <T>(table: string, cols: string[]): Promise<T | undefined> =>
      (await db(table).where({ id: r.targetId }).first(cols)) as T | undefined;
    const clip = (v: string | null | undefined): string | null =>
      v == null ? null : v.length > PREVIEW_CHARS ? `${v.slice(0, PREVIEW_CHARS)}…` : v;
    const gone = { preview: null, authorUserId: null, exists: false };
    switch (r.targetType) {
      case 'MESSAGE': {
        const m = await one<{ body: string; sender_user_id: string }>('messages', [
          'body',
          'sender_user_id',
        ]);
        return m ? { preview: clip(m.body), authorUserId: m.sender_user_id, exists: true } : gone;
      }
      case 'ROOM':
      case 'ORGANIZATION': {
        const o = await one<{ name: string; owner_user_id: string | null }>('organizations', [
          'name',
          'owner_user_id',
        ]);
        return o ? { preview: clip(o.name), authorUserId: o.owner_user_id, exists: true } : gone;
      }
      case 'USER': {
        const u = await one<{ first_name: string; last_name: string }>('users', [
          'first_name',
          'last_name',
        ]);
        return u
          ? {
              preview: `${u.first_name} ${u.last_name}`.trim(),
              authorUserId: r.targetId,
              exists: true,
            }
          : gone;
      }
      case 'ANIMAL_PUBLICATION': {
        const p = await one<{
          kind: string;
          note: string | null;
          extra_notes: string | null;
          created_by_user_id: string | null;
        }>('animal_publications', ['kind', 'note', 'extra_notes', 'created_by_user_id']);
        return p
          ? {
              preview: clip(`[${p.kind}] ${p.note ?? p.extra_notes ?? ''}`.trim()),
              authorUserId: p.created_by_user_id,
              exists: true,
            }
          : gone;
      }
      case 'ORGANIZATION_REVIEW': {
        const v = await one<{ rating: number; comment: string | null; user_id: string }>(
          'organization_reviews',
          ['rating', 'comment', 'user_id'],
        );
        return v
          ? {
              preview: clip(`${'★'.repeat(v.rating)} ${v.comment ?? ''}`.trim()),
              authorUserId: v.user_id,
              exists: true,
            }
          : gone;
      }
      case 'CONTENT_COMMENT': {
        const c = await one<{ body: string; user_id: string; deleted_at: Date | null }>(
          'content_comments',
          ['body', 'user_id', 'deleted_at'],
        );
        return c && !c.deleted_at
          ? { preview: clip(c.body), authorUserId: c.user_id, exists: true }
          : gone;
      }
      case 'AI_MESSAGE': {
        for (const table of AI_MESSAGE_TABLES) {
          const m = await one<{ body: string }>(table, ['body']);
          if (m) return { preview: clip(m.body), authorUserId: null, exists: true };
        }
        return gone;
      }
      default:
        return gone;
    }
  }

  async review(id: string, status: ReportStatus, actor: ReportActor): Promise<ContentReport> {
    if (status === 'PENDING') throw new ValidationError('Cannot set a report back to PENDING');
    const existing = await this.reports.findById(id);
    if (!existing) throw new NotFoundError('Report not found');

    const updated = await this.reports.updateStatus(id, status, actor.actorUserId);
    if (!updated) throw new NotFoundError('Report not found');

    await this.audit.record({
      action: AuditAction.CONTENT_REPORT_REVIEWED,
      entityType: AuditEntityType.CONTENT_REPORT,
      entityId: id,
      actorUserId: actor.actorUserId,
      metadata: { status },
      context: actor.context,
    });
    return updated;
  }
}
