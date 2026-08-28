import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import { StorePolicy } from '../domain/store.policy.js';
import {
  toProductDTO,
  type CreateProductInput,
  type ListProductsFilter,
  type ProductDTO,
  type UpdateProductInput,
} from '../domain/store.types.js';
import type { ProductRepository } from '../infrastructure/product.repository.js';

export interface StoreActor {
  actorUserId: string;
  context?: AuditContext;
}

export interface OrgRef {
  id: string;
  type: string;
}

/**
 * Veterinary Store product lifecycle. Every product belongs to exactly one
 * VETERINARY_STORE organization (DB composite FK to `organizations(id, type)`),
 * and every lookup is `organization_id`-scoped so a member of Store A can never
 * touch Store B's products. Stock is only changed through {@link adjustStock}.
 */
export class ProductService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly products: ProductRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'product-service' });
  }

  async create(org: OrgRef, input: CreateProductInput, actor: StoreActor): Promise<ProductDTO> {
    StorePolicy.assertVeterinaryStore(org);

    const product = await this.db.transaction(async (tx) => {
      const created = await this.products.create(
        {
          organizationId: org.id,
          name: input.name,
          description: input.description ?? null,
          productType: input.productType,
          price: input.price ?? null,
          stockQuantity: input.stockQuantity ?? 0,
          createdByUserId: actor.actorUserId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: AuditAction.PRODUCT_CREATED,
          entityType: AuditEntityType.PRODUCT,
          entityId: created.id,
          actorUserId: actor.actorUserId,
          metadata: { organizationId: org.id, productId: created.id },
          context: actor.context,
        },
        tx,
      );
      return created;
    });

    this.events.publish('product.created', { productId: product.id, organizationId: org.id });
    return toProductDTO(product);
  }

  async get(organizationId: string, productId: string): Promise<ProductDTO> {
    const product = await this.products.findByIdForOrganization(productId, organizationId);
    if (!product) throw new NotFoundError('Product not found');
    return toProductDTO(product);
  }

  async list(
    organizationId: string,
    filter: ListProductsFilter,
  ): Promise<{ items: ProductDTO[]; total: number }> {
    const { items, total } = await this.products.listForOrganization(organizationId, filter);
    return { items: items.map(toProductDTO), total };
  }

  async update(
    organizationId: string,
    productId: string,
    patch: UpdateProductInput,
    actor: StoreActor,
  ): Promise<ProductDTO> {
    const existing = await this.products.findByIdForOrganization(productId, organizationId);
    if (!existing) throw new NotFoundError('Product not found');

    const updated = await this.db.transaction(async (tx) => {
      const product = await this.products.update(productId, patch, tx);
      await this.audit.record(
        {
          action: AuditAction.PRODUCT_UPDATED,
          entityType: AuditEntityType.PRODUCT,
          entityId: productId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, productId, fields: Object.keys(patch) },
          context: actor.context,
        },
        tx,
      );
      return product;
    });

    this.events.publish('product.updated', { productId, organizationId });
    return toProductDTO(updated);
  }

  /** Soft-delete: `status = INACTIVE`. Idempotent. Product history is preserved. */
  async deactivate(
    organizationId: string,
    productId: string,
    actor: StoreActor,
  ): Promise<ProductDTO> {
    const existing = await this.products.findByIdForOrganization(productId, organizationId);
    if (!existing) throw new NotFoundError('Product not found');
    if (existing.status === 'INACTIVE') return toProductDTO(existing);

    const updated = await this.db.transaction(async (tx) => {
      const product = await this.products.update(productId, { status: 'INACTIVE' }, tx);
      await this.audit.record(
        {
          action: AuditAction.PRODUCT_DEACTIVATED,
          entityType: AuditEntityType.PRODUCT,
          entityId: productId,
          actorUserId: actor.actorUserId,
          metadata: { organizationId, productId },
          context: actor.context,
        },
        tx,
      );
      return product;
    });

    this.events.publish('product.deactivated', { productId, organizationId });
    return toProductDTO(updated);
  }

  /** Controlled stock movement. `delta` is signed; the result may not go negative. */
  async adjustStock(
    organizationId: string,
    productId: string,
    delta: number,
    reason: string | null,
    actor: StoreActor,
  ): Promise<ProductDTO> {
    const existing = await this.products.findByIdForOrganization(productId, organizationId);
    if (!existing) throw new NotFoundError('Product not found');

    const nextQuantity = StorePolicy.applyStockDelta(existing.stockQuantity, delta);

    const updated = await this.db.transaction(async (tx) => {
      const product = await this.products.setStock(productId, nextQuantity, tx);
      await this.audit.record(
        {
          action: AuditAction.PRODUCT_INVENTORY_ADJUSTED,
          entityType: AuditEntityType.PRODUCT,
          entityId: productId,
          actorUserId: actor.actorUserId,
          metadata: {
            organizationId,
            productId,
            delta,
            previousQuantity: existing.stockQuantity,
            newQuantity: nextQuantity,
            reason,
          },
          context: actor.context,
        },
        tx,
      );
      return product;
    });

    this.events.publish('inventory.adjusted', { productId, organizationId });
    return toProductDTO(updated);
  }
}
