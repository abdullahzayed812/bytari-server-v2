import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import type { AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import { SyndicateAuditAction, SyndicateAuditEntity, SyndicateEvent } from '../domain/syndicate.constants.js';
import type {
  AnnouncementListFilter,
  CreateAnnouncementInput,
  SyndicateAnnouncement,
  SyndicateAnnouncementDTO,
  UpdateAnnouncementInput,
} from '../domain/syndicate.types.js';
import type { SyndicateAnnouncementRepository } from '../infrastructure/syndicate-announcement.repository.js';
import type { SyndicateMedia } from './syndicate-media.js';
import type { SyndicateService } from './syndicate.service.js';

export interface SyndicateActor {
  principal: AuthPrincipal;
  context?: AuditContext;
}

/**
 * "الإعلانات والتبليغات" — a syndicate (main or branch) announces directly to
 * its audience. No moderation: only a trusted OWNER/ADMIN or an explicitly
 * assigned `syndicate.announcement.manage` supervisor can create one at all,
 * so it publishes immediately (unlike the user-submitted marketplaces).
 */
export class SyndicateAnnouncementService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly announcements: SyndicateAnnouncementRepository,
    private readonly syndicates: SyndicateService,
    private readonly media: SyndicateMedia,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'syndicate-announcement-service' });
  }

  private async toDTO(announcement: SyndicateAnnouncement | null): Promise<SyndicateAnnouncementDTO> {
    if (!announcement) throw new NotFoundError('Announcement not found');
    const org = await this.syndicates.loadOrganizationContext(announcement.organizationId);
    const { imageStorageKey, ...rest } = announcement;
    return {
      ...rest,
      imageUrl: await this.media.resolveUrl(imageStorageKey),
      syndicateName: org?.name ?? '',
    };
  }

  async create(
    organizationId: string,
    input: CreateAnnouncementInput,
    actor: SyndicateActor,
  ): Promise<SyndicateAnnouncementDTO> {
    const org = await this.syndicates.loadOrganizationContext(organizationId);
    if (!org || org.type !== 'SYNDICATE') throw new NotFoundError('Syndicate not found');
    const imageStorageKey = await this.media.validateKey('ANNOUNCEMENT_IMAGE', input.imageStorageKey);

    const created = await this.db.transaction(async (tx) => {
      const a = await this.announcements.create(
        organizationId,
        actor.principal.userId,
        { ...input, imageStorageKey },
        tx,
      );
      await this.audit.record(
        {
          action: SyndicateAuditAction.ANNOUNCEMENT_CREATED,
          entityType: SyndicateAuditEntity.ANNOUNCEMENT,
          entityId: a.id,
          actorUserId: actor.principal.userId,
          metadata: { organizationId, title: a.title },
          context: actor.context,
        },
        tx,
      );
      return a;
    });

    this.events.publish(SyndicateEvent.ANNOUNCEMENT_PUBLISHED, {
      announcementId: created.id,
      organizationId,
      title: created.title,
      actorUserId: actor.principal.userId,
    });
    return this.toDTO(created);
  }

  async update(
    organizationId: string,
    id: string,
    patch: UpdateAnnouncementInput,
    actor: SyndicateActor,
  ): Promise<SyndicateAnnouncementDTO> {
    const existing = await this.announcements.findById(id);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundError('Announcement not found');
    }
    const imageStorageKey =
      patch.imageStorageKey !== undefined
        ? await this.media.validateKey('ANNOUNCEMENT_IMAGE', patch.imageStorageKey)
        : undefined;

    const updated = await this.db.transaction(async (tx) => {
      const a = await this.announcements.update(id, { ...patch, imageStorageKey }, tx);
      await this.audit.record(
        {
          action: SyndicateAuditAction.ANNOUNCEMENT_UPDATED,
          entityType: SyndicateAuditEntity.ANNOUNCEMENT,
          entityId: id,
          actorUserId: actor.principal.userId,
          metadata: { fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return a;
    });
    return this.toDTO(updated);
  }

  async remove(organizationId: string, id: string, actor: SyndicateActor): Promise<void> {
    const existing = await this.announcements.findById(id);
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundError('Announcement not found');
    }
    await this.db.transaction(async (tx) => {
      await this.announcements.deleteById(id, tx);
      await this.audit.record(
        {
          action: SyndicateAuditAction.ANNOUNCEMENT_DELETED,
          entityType: SyndicateAuditEntity.ANNOUNCEMENT,
          entityId: id,
          actorUserId: actor.principal.userId,
          context: actor.context,
        },
        tx,
      );
    });
  }

  async listForOrganization(
    organizationId: string,
    filter: AnnouncementListFilter,
  ): Promise<{ items: SyndicateAnnouncementDTO[]; total: number }> {
    const org = await this.syndicates.loadOrganizationContext(organizationId);
    if (!org || org.type !== 'SYNDICATE') throw new NotFoundError('Syndicate not found');
    const { items, total } = await this.announcements.listForOrganization(organizationId, filter);
    return { items: await Promise.all(items.map((a) => this.toDTO(a))), total };
  }

  async getOne(id: string): Promise<SyndicateAnnouncementDTO> {
    return this.toDTO(await this.announcements.findById(id));
  }

  /** Latest announcements across a syndicate + its branches — the home-screen carousel. */
  async listRecentForOrganizations(
    organizationIds: string[],
    limit: number,
  ): Promise<SyndicateAnnouncementDTO[]> {
    const items = await this.announcements.listRecentForOrganizations(organizationIds, limit);
    return Promise.all(items.map((a) => this.toDTO(a)));
  }
}
