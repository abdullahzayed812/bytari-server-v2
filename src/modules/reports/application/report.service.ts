import type { Logger } from 'pino';
import { NotFoundError, ValidationError } from '../../../shared/errors/app-error.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { MessageRepository } from '../../chat/infrastructure/message.repository.js';
import type { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import type {
  ContentReport,
  ListReportsFilter,
  ReportStatus,
  SubmitReportInput,
} from '../domain/report.types.js';
import type { ReportRepository } from '../infrastructure/report.repository.js';

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
    } else {
      throw new ValidationError('Unknown report target type');
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

  async listForAdmin(filter: ListReportsFilter): Promise<{ items: ContentReport[]; total: number }> {
    return this.reports.list(filter);
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
