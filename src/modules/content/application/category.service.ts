import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { Category } from '../domain/content.types.js';
import type { CategoryRepository } from '../infrastructure/category.repository.js';

export interface CategoryActor {
  actorUserId: string;
  context?: AuditContext;
}

/** Admin-managed content categories (a lightweight M:N label set). */
export class CategoryService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly repo: CategoryRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'category-service' });
  }

  list(): Promise<Category[]> {
    return this.repo.list();
  }

  async create(
    actor: CategoryActor,
    input: { slug: string; name: string; description?: string | null },
  ): Promise<Category> {
    if (await this.repo.slugExists(input.slug)) {
      throw new ConflictError(`category slug "${input.slug}" already exists`);
    }
    const category = await this.db.transaction(async (tx) => {
      const created = await this.repo.create(
        {
          slug: input.slug,
          name: input.name,
          description: input.description ?? null,
          createdByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.CONTENT_CATEGORY_CREATED,
          entityType: AuditEntityType.CONTENT_CATEGORY,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { categoryId: created.id, slug: created.slug },
          context: actor.context,
        },
        tx,
      );
      return created;
    });
    this.events.publish('content.category.created', { categoryId: category.id });
    return category;
  }

  async update(
    actor: CategoryActor,
    id: string,
    patch: { name?: string; description?: string | null },
  ): Promise<Category> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Category not found');

    const category = await this.db.transaction(async (tx) => {
      const next = await this.repo.update(id, patch, tx);
      await this.audit.record(
        {
          action: AuditAction.CONTENT_CATEGORY_UPDATED,
          entityType: AuditEntityType.CONTENT_CATEGORY,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { categoryId: id, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return next;
    });
    this.events.publish('content.category.updated', { categoryId: id });
    return category;
  }

  async remove(actor: CategoryActor, id: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundError('Category not found');

    await this.db.transaction(async (tx) => {
      await this.repo.softDelete(id, tx);
      await this.audit.record(
        {
          action: AuditAction.CONTENT_CATEGORY_DELETED,
          entityType: AuditEntityType.CONTENT_CATEGORY,
          entityId: id,
          actorUserId: actor.actorUserId,
          metadata: { categoryId: id, slug: existing.slug },
          context: actor.context,
        },
        tx,
      );
    });
    this.events.publish('content.category.deleted', { categoryId: id });
  }
}
