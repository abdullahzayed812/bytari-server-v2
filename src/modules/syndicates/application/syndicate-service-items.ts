import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { randomUUID } from 'node:crypto';
import { NotFoundError, ValidationError } from '../../../shared/errors/app-error.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import { SyndicateAuditAction, SyndicateAuditEntity } from '../domain/syndicate.constants.js';
import {
  SYNDICATE_CONTENT_SERVICE_KEYS,
  type SyndicateServiceContent,
  type SyndicateServiceContentInput,
  type SyndicateServiceItem,
  type SyndicateServiceItemPatch,
  type UpdateSyndicateServiceItemInput,
} from '../domain/syndicate-service-item.types.js';
import type { SyndicateServiceItemRepository } from '../infrastructure/syndicate-service-item.repository.js';
import type { SyndicateActor } from './syndicate.service.js';

/** Keep the editor's ids (stable keys); assign one where missing or repeated. */
function withStableIds(content: SyndicateServiceContentInput): SyndicateServiceContent {
  const used = new Set<string>();
  const idFor = (id: string | undefined): string => {
    const next = id && !used.has(id) ? id : randomUUID();
    used.add(next);
    return next;
  };
  return {
    ...content,
    sections: content.sections.map((section) => ({
      ...section,
      id: idFor(section.id),
      items: section.items.map((item) => ({ ...item, id: idFor(item.id) })),
    })),
  };
}

/**
 * "الخدمات" of a syndicate: readable by any authenticated user (the syndicate
 * page is public), edited by its managers — `syndicate.profile.manage`, the
 * same permission as "تعديل معلومات النقابة", enforced by the route.
 */
export class SyndicateServiceItems {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly items: SyndicateServiceItemRepository,
    private readonly organizations: OrganizationRepository,
    private readonly audit: AuditService,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'syndicate-service-items' });
  }

  private async assertSyndicate(organizationId: string): Promise<void> {
    const org = await this.organizations.findById(organizationId);
    if (!org || org.type !== 'SYNDICATE' || org.status !== 'ACTIVE') {
      throw new NotFoundError('Syndicate not found');
    }
  }

  async list(organizationId: string): Promise<SyndicateServiceItem[]> {
    await this.assertSyndicate(organizationId);
    await this.items.ensureFor(organizationId);
    return this.items.listFor(organizationId);
  }

  async update(
    organizationId: string,
    serviceId: string,
    patch: UpdateSyndicateServiceItemInput,
    actor: SyndicateActor,
  ): Promise<SyndicateServiceItem> {
    await this.assertSyndicate(organizationId);
    const existing = await this.items.findForOrganization(serviceId, organizationId);
    if (!existing) throw new NotFoundError('Syndicate service not found');
    if (
      patch.content &&
      !(SYNDICATE_CONTENT_SERVICE_KEYS as readonly string[]).includes(existing.serviceKey)
    ) {
      throw new ValidationError('This service has no editable page content', [
        { path: 'content', message: `not supported for ${existing.serviceKey}` },
      ]);
    }
    const { content, ...fields } = patch;
    const input: SyndicateServiceItemPatch =
      content === undefined
        ? fields
        : { ...fields, content: content === null ? null : withStableIds(content) };
    return this.db.transaction(async (tx) => {
      const updated = await this.items.update(serviceId, input, actor.principal.userId, tx);
      await this.audit.record(
        {
          action: SyndicateAuditAction.SERVICE_UPDATED,
          entityType: SyndicateAuditEntity.SERVICE,
          entityId: serviceId,
          actorUserId: actor.principal.userId,
          metadata: { organizationId, serviceKey: existing.serviceKey, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return updated;
    });
  }
}
