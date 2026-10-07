import type { Knex } from 'knex';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type {
  QuickReviewTemplateDTO,
  QuickReviewTemplateInput,
} from '../domain/veterinary-care.types.js';
import type { QuickReviewTemplateRepository } from '../infrastructure/quick-review-template.repository.js';

export interface TemplateActor {
  actorUserId: string;
  context?: AuditContext;
}

/**
 * A clinic's quick-review templates ("إعدادات المراجعة السريعة"). A template id
 * from another clinic is a 404 — every lookup is scoped to the URL's clinic.
 */
export class QuickReviewTemplateService {
  constructor(
    private readonly db: Knex,
    private readonly templates: QuickReviewTemplateRepository,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string): Promise<QuickReviewTemplateDTO[]> {
    return this.templates.listForClinic(organizationId);
  }

  async create(
    organizationId: string,
    input: QuickReviewTemplateInput,
    actor: TemplateActor,
  ): Promise<QuickReviewTemplateDTO> {
    return this.db.transaction(async (tx) => {
      const created = await this.templates.create(organizationId, actor.actorUserId, input, tx);
      await this.audit.record(
        {
          action: AuditAction.QUICK_REVIEW_TEMPLATE_CREATED,
          entityType: AuditEntityType.QUICK_REVIEW_TEMPLATE,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, templateId: created.id },
          context: actor.context,
        },
        tx,
      );
      return created;
    });
  }

  async update(
    organizationId: string,
    templateId: string,
    patch: Partial<QuickReviewTemplateInput>,
    actor: TemplateActor,
  ): Promise<QuickReviewTemplateDTO> {
    if (!(await this.templates.findByIdForClinic(templateId, organizationId))) {
      throw new NotFoundError('Template not found');
    }
    return this.db.transaction(async (tx) => {
      const updated = await this.templates.update(templateId, patch, tx);
      await this.audit.record(
        {
          action: AuditAction.QUICK_REVIEW_TEMPLATE_UPDATED,
          entityType: AuditEntityType.QUICK_REVIEW_TEMPLATE,
          entityId: templateId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, templateId, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return updated;
    });
  }

  async delete(organizationId: string, templateId: string, actor: TemplateActor): Promise<void> {
    if (!(await this.templates.findByIdForClinic(templateId, organizationId))) {
      throw new NotFoundError('Template not found');
    }
    await this.db.transaction(async (tx) => {
      await this.templates.deleteById(templateId, tx);
      await this.audit.record(
        {
          action: AuditAction.QUICK_REVIEW_TEMPLATE_DELETED,
          entityType: AuditEntityType.QUICK_REVIEW_TEMPLATE,
          entityId: templateId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, templateId },
          context: actor.context,
        },
        tx,
      );
    });
  }
}
