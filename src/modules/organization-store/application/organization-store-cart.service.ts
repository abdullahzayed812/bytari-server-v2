import type { Knex } from 'knex';
import { BadRequestError, NotFoundError } from '../../../shared/errors/app-error.js';
import type { ObjectStorage } from '../../../infra/storage/index.js';
import type { OrganizationRepository } from '../../organizations/infrastructure/organization.repository.js';
import { resolveVeterinaryOfficeProductImageUrlOrNull } from '../../veterinary-office/application/veterinary-office-product-media.js';
import type { VeterinaryOfficeProductService } from '../../veterinary-office/application/veterinary-office-product.service.js';
import type { VeterinaryOfficeProductRepository } from '../../veterinary-office/infrastructure/veterinary-office-product.repository.js';
import {
  ORGANIZATION_STORE_DELIVERY_FEE,
  ORGANIZATION_STORE_MAX_CART_LINES,
  ORGANIZATION_STORE_MAX_ITEM_QUANTITY,
} from '../domain/organization-store.constants.js';
import { multiplyMoney, OrganizationStorePolicy } from '../domain/organization-store.policy.js';
import type {
  OrganizationStoreCartDTO,
  OrganizationStoreCartSummaryDTO,
} from '../domain/organization-store.types.js';
import type {
  CartLineWithProduct,
  OrganizationStoreCartRepository,
} from '../infrastructure/organization-store-cart.repository.js';

/** Is a cart line orderable right now (ACTIVE, visible, priced)? */
export function isLineAvailable(line: CartLineWithProduct): boolean {
  return line.status === 'ACTIVE' && !line.isHidden && line.price !== null;
}

/**
 * The shopper's cart for ONE clinic / veterinary office store. Every method is
 * scoped to `(userId, organizationId)`, so a caller can only ever read or
 * change their own cart, and a line can only hold that organization's
 * products. Prices are always live — the snapshot happens at checkout.
 */
export class OrganizationStoreCartService {
  constructor(
    private readonly db: Knex,
    private readonly carts: OrganizationStoreCartRepository,
    private readonly products: VeterinaryOfficeProductRepository,
    private readonly catalog: VeterinaryOfficeProductService,
    private readonly organizations: OrganizationRepository,
    private readonly storage: ObjectStorage,
  ) {}

  /** A store-type organization must exist; otherwise 404 (visibility, not validation). */
  private async assertStoreExists(organizationId: string): Promise<void> {
    const org = await this.organizations.findById(organizationId);
    if (!org || !OrganizationStorePolicy.isStoreOrganizationType(org.type)) {
      throw new NotFoundError('Store not found');
    }
  }

  async getCart(userId: string, organizationId: string): Promise<OrganizationStoreCartDTO> {
    await this.assertStoreExists(organizationId);
    const cart = await this.carts.findCart(userId, organizationId);
    if (!cart) return this.toDTO(null, organizationId, []);
    return this.toDTO(cart.id, organizationId, await this.carts.listLines(cart.id));
  }

  async listMyCarts(userId: string): Promise<OrganizationStoreCartSummaryDTO[]> {
    return this.carts.listNonEmptyForUser(userId);
  }

  async addItem(
    userId: string,
    organizationId: string,
    productId: string,
    quantity: number,
  ): Promise<OrganizationStoreCartDTO> {
    OrganizationStorePolicy.assertQuantity(quantity);
    // The store must be open for business: ACTIVE and not expired.
    await this.catalog.assertPubliclyBrowsable(organizationId);

    const cartId = await this.db.transaction(async (tx) => {
      const product = await this.products.findByIdForOrganization(productId, organizationId, tx);
      if (!product) throw new NotFoundError('Product not found');
      OrganizationStorePolicy.assertPurchasable(product, organizationId);

      const cart = await this.carts.getOrCreateCart(userId, organizationId, tx);
      const lines = await this.carts.listLines(cart.id, tx);
      const others = lines.filter((l) => l.productId !== productId);
      OrganizationStorePolicy.assertSameCurrency(others[0]?.currency ?? null, product.currency);

      const existing = lines.find((l) => l.productId === productId);
      if (!existing && lines.length >= ORGANIZATION_STORE_MAX_CART_LINES) {
        throw new BadRequestError(
          `A cart may hold at most ${ORGANIZATION_STORE_MAX_CART_LINES} different products`,
        );
      }
      const next = Math.min(
        (existing?.quantity ?? 0) + quantity,
        ORGANIZATION_STORE_MAX_ITEM_QUANTITY,
      );
      await this.carts.upsertItem(cart.id, productId, next, tx);
      return cart.id;
    });

    return this.toDTO(cartId, organizationId, await this.carts.listLines(cartId));
  }

  async updateItem(
    userId: string,
    organizationId: string,
    itemId: string,
    quantity: number,
  ): Promise<OrganizationStoreCartDTO> {
    OrganizationStorePolicy.assertQuantity(quantity);
    const cartId = await this.db.transaction(async (tx) => {
      const cart = await this.carts.findCart(userId, organizationId, tx);
      const item = cart ? await this.carts.findItemById(cart.id, itemId, tx) : null;
      if (!cart || !item) throw new NotFoundError('Cart item not found');
      await this.carts.setItemQuantity(itemId, quantity, tx);
      return cart.id;
    });
    return this.toDTO(cartId, organizationId, await this.carts.listLines(cartId));
  }

  async removeItem(
    userId: string,
    organizationId: string,
    itemId: string,
  ): Promise<OrganizationStoreCartDTO> {
    const cartId = await this.db.transaction(async (tx) => {
      const cart = await this.carts.findCart(userId, organizationId, tx);
      const item = cart ? await this.carts.findItemById(cart.id, itemId, tx) : null;
      if (!cart || !item) throw new NotFoundError('Cart item not found');
      await this.carts.deleteItem(itemId, tx);
      return cart.id;
    });
    return this.toDTO(cartId, organizationId, await this.carts.listLines(cartId));
  }

  async clearCart(userId: string, organizationId: string): Promise<OrganizationStoreCartDTO> {
    await this.assertStoreExists(organizationId);
    const cartId = await this.db.transaction(async (tx) => {
      const cart = await this.carts.findCart(userId, organizationId, tx);
      if (cart) await this.carts.clear(cart.id, tx);
      return cart?.id ?? null;
    });
    return this.toDTO(cartId, organizationId, []);
  }

  async toDTO(
    cartId: string | null,
    organizationId: string,
    lines: CartLineWithProduct[],
  ): Promise<OrganizationStoreCartDTO> {
    const items = await Promise.all(
      lines.map(async (l) => {
        const available = isLineAvailable(l);
        return {
          id: l.id,
          productId: l.productId,
          name: l.name,
          primaryImageUrl: await resolveVeterinaryOfficeProductImageUrlOrNull(
            this.storage,
            l.primaryImageKey,
          ),
          unitPrice: l.price,
          currency: l.currency,
          quantity: l.quantity,
          lineTotal: l.price === null ? null : multiplyMoney(l.price, l.quantity),
          available,
        };
      }),
    );
    const priced = items.filter((i) => i.available && i.unitPrice !== null);
    const totals = OrganizationStorePolicy.computeTotals(
      priced.map((i) => ({ unitPrice: i.unitPrice as string, quantity: i.quantity })),
      ORGANIZATION_STORE_DELIVERY_FEE,
    );
    return {
      id: cartId,
      organizationId,
      items,
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
      ...totals,
      currency: items[0]?.currency ?? null,
    };
  }
}
