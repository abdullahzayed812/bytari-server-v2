import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { ObjectStorage } from '../../../infra/storage/index.js';
import {
  VETERINARIAN_STORE_CURRENCY,
  VETERINARIAN_STORE_DELIVERY_FEE,
  VETERINARIAN_STORE_MAX_ITEM_QUANTITY,
} from '../domain/veterinarian-store.constants.js';
import { VeterinarianStorePolicy, multiplyMoney } from '../domain/veterinarian-store.policy.js';
import type { VeterinarianStoreCartDTO, VeterinarianStoreCartItemDTO } from '../domain/veterinarian-store.types.js';
import type {
  CartItemWithProduct,
  VeterinarianStoreCartRepository,
} from '../infrastructure/cart.repository.js';
import type { VeterinarianStoreProductRepository } from '../infrastructure/product.repository.js';
import { resolveVeterinarianStoreImageUrlOrNull } from './veterinarian-store-media.js';

/**
 * The signed-in shopper's cart. Exactly one active cart per user
 * (`uq_pos_carts_user`). Prices shown are always live — the snapshot happens at
 * checkout. Every method is scoped to `userId`, so a caller can only ever see
 * or mutate their own cart.
 */
export class VeterinarianStoreCartService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly carts: VeterinarianStoreCartRepository,
    private readonly products: VeterinarianStoreProductRepository,
    private readonly storage: ObjectStorage,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'veterinarian-store-cart-service' });
  }

  async getCart(userId: string): Promise<VeterinarianStoreCartDTO> {
    const cart = await this.db.transaction((tx) => this.carts.getOrCreateCart(userId, tx));
    const items = await this.carts.listItemsWithProduct(cart.id);
    return this.toDTO(cart.id, items);
  }

  async addItem(userId: string, productId: string, quantity: number): Promise<VeterinarianStoreCartDTO> {
    VeterinarianStorePolicy.assertQuantity(quantity);

    const cartId = await this.db.transaction(async (tx) => {
      const product = await this.products.findById(productId, tx);
      if (!product || product.status !== 'ACTIVE') throw new NotFoundError('Product not found');

      const cart = await this.carts.getOrCreateCart(userId, tx);
      const existing = await this.carts.findItem(cart.id, productId, tx);
      const currentQty = existing ? Number(existing.quantity) : 0;
      const clampedQty = Math.min(currentQty + quantity, VETERINARIAN_STORE_MAX_ITEM_QUANTITY);
      VeterinarianStorePolicy.assertPurchasable(product, clampedQty);
      await this.carts.upsertItem(cart.id, productId, clampedQty, tx);
      return cart.id;
    });

    return this.toDTO(cartId, await this.carts.listItemsWithProduct(cartId));
  }

  async updateItem(userId: string, itemId: string, quantity: number): Promise<VeterinarianStoreCartDTO> {
    VeterinarianStorePolicy.assertQuantity(quantity);

    const cartId = await this.db.transaction(async (tx) => {
      const cart = await this.carts.findCartByUser(userId, tx);
      if (!cart) throw new NotFoundError('Cart item not found');
      const item = await this.carts.findItemById(cart.id, itemId, tx);
      if (!item) throw new NotFoundError('Cart item not found');

      const product = await this.products.findById(item.product_id, tx);
      if (!product || product.status !== 'ACTIVE') throw new NotFoundError('Product not found');
      VeterinarianStorePolicy.assertPurchasable(product, quantity);

      await this.carts.setItemQuantity(itemId, quantity, tx);
      return cart.id;
    });

    return this.toDTO(cartId, await this.carts.listItemsWithProduct(cartId));
  }

  async removeItem(userId: string, itemId: string): Promise<VeterinarianStoreCartDTO> {
    const cartId = await this.db.transaction(async (tx) => {
      const cart = await this.carts.findCartByUser(userId, tx);
      if (!cart) throw new NotFoundError('Cart item not found');
      const item = await this.carts.findItemById(cart.id, itemId, tx);
      if (!item) throw new NotFoundError('Cart item not found');
      await this.carts.deleteItem(itemId, tx);
      return cart.id;
    });

    return this.toDTO(cartId, await this.carts.listItemsWithProduct(cartId));
  }

  async clearCart(userId: string): Promise<VeterinarianStoreCartDTO> {
    const cartId = await this.db.transaction(async (tx) => {
      const cart = await this.carts.getOrCreateCart(userId, tx);
      await this.carts.clear(cart.id, tx);
      return cart.id;
    });
    return this.toDTO(cartId, []);
  }

  private async toDTO(cartId: string, items: CartItemWithProduct[]): Promise<VeterinarianStoreCartDTO> {
    const itemDTOs: VeterinarianStoreCartItemDTO[] = await Promise.all(
      items.map(async (it) => ({
        id: it.id,
        productId: it.productId,
        name: it.name,
        primaryImageUrl: await resolveVeterinarianStoreImageUrlOrNull(this.storage, it.primaryImageKey),
        unitPrice: it.price,
        quantity: it.quantity,
        lineTotal: multiplyMoney(it.price, it.quantity),
        inStock: it.status === 'ACTIVE' && it.stockQuantity >= it.quantity,
        availableStock: it.stockQuantity,
      })),
    );

    const totals = VeterinarianStorePolicy.computeTotals(
      itemDTOs.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity })),
      VETERINARIAN_STORE_DELIVERY_FEE,
    );

    return {
      id: cartId,
      items: itemDTOs,
      itemCount: itemDTOs.reduce((n, i) => n + i.quantity, 0),
      subtotalAmount: totals.subtotalAmount,
      deliveryFee: totals.deliveryFee,
      totalAmount: totals.totalAmount,
      currency: VETERINARIAN_STORE_CURRENCY,
    };
  }
}
