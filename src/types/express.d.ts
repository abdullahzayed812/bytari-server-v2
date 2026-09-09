/**
 * Ambient augmentation of the Express request.
 *
 * Keep this minimal and additive — one property per cross-cutting concern.
 * `req.id` and `req.log` are contributed by `pino-http`'s own type augmentation.
 */
declare global {
  namespace Express {
    /**
     * Identity context attached by the `authenticate` middleware once a valid
     * access token has been verified and the user loaded. Absent on public
     * routes and whenever authentication has not run.
     */
    interface AuthContext {
      userId: string;
      email: string;
      status: string;
      veterinarianStatus: string;
      traderStatus: string;
      roleKeys: string[];
      /** Refresh session id from the access token, when present. */
      sessionId: string | null;
    }

    /**
     * Organization resolved from a trusted route parameter (`:organizationId`)
     * by the `withOrganization` middleware. NEVER derived from the request body.
     */
    interface OrganizationContext {
      id: string;
      type: string;
      status: string;
      ownerUserId: string;
    }

    /**
     * Animal + current-owner context resolved from a trusted route parameter
     * (`:animalId`) by the `withAnimal` middleware. NEVER from the request body.
     */
    interface AnimalContext {
      id: string;
      status: string;
      currentOwnerUserId: string | null;
    }

    /**
     * Animal resolved from `:animalId` by the veterinary-care
     * `withVeterinaryAnimalAccess` middleware AFTER `withOrganization` +
     * `authorizeOrg`: the resolved clinic holds an ACTIVE veterinary-access
     * grant to this animal (or the caller is ADMIN). NEVER from the body.
     */
    interface VeterinaryAnimalContext {
      id: string;
      status: string;
    }

    /**
     * Poultry flock resolved from `:flockId` by the farms `withPoultryFlock`
     * middleware AFTER `withOrganization` + `authorizeOrg`. The flock is
     * guaranteed to belong to the URL's farm organization. NEVER from the body.
     */
    interface PoultryFlockContext {
      id: string;
      status: string;
      organizationId: string;
    }

    /**
     * Sheep/cattle batch resolved from `:batchId` by the livestock module's
     * `withSheepBatch`/`withCattleBatch` middleware AFTER `withOrganization` +
     * `authorizeOrg`. Guaranteed to belong to the URL's farm organization.
     * NEVER from the body.
     */
    interface SheepBatchContext {
      id: string;
      status: string;
      organizationId: string;
    }
    interface CattleBatchContext {
      id: string;
      status: string;
      organizationId: string;
    }

    /**
     * Product resolved from `:productId` by the veterinary-store `withProduct`
     * middleware AFTER `withOrganization` + the VETERINARY_STORE type check +
     * `authorizeOrg`. The product is guaranteed to belong to the URL's store.
     * NEVER from the body.
     */
    interface ProductContext {
      id: string;
      status: string;
      organizationId: string;
    }

    /**
     * Conversation resolved from `:conversationId` by the chat `withConversation`
     * middleware, which has ALREADY run the live relationship check
     * (`ChatService.assertAccess`). `viewerSide` is the caller's resolved side.
     * NEVER derived from the request body.
     */
    interface ConversationContext {
      id: string;
      type: string;
      organizationId: string | null;
      viewerSide: string;
      status: string;
    }

    /**
     * Poultry-market offer resolved from `:offerId` by the market
     * `withPoultryOffer` middleware. NEVER derived from the request body.
     */
    interface PoultryOfferContext {
      id: string;
      status: string;
      traderUserId: string;
    }

    /**
     * Egg-market offer resolved from `:offerId` by the market `withEggOffer`
     * middleware. NEVER derived from the request body.
     */
    interface EggOfferContext {
      id: string;
      status: string;
      traderUserId: string;
    }

    interface Request {
      /** Output of the `validate()` middleware, when present. */
      validated?: {
        body: unknown;
        query: unknown;
        params: unknown;
      };
      /** Populated by `authenticate`. Use `requireAuth(req)` to access it safely. */
      auth?: AuthContext;
      /** Populated by `withOrganization`. Use `requireOrganization(req)` to access it. */
      organization?: OrganizationContext;
      /** Populated by `withAnimal`. Use `requireAnimal(req)` to access it. */
      animal?: AnimalContext;
      /**
       * Populated by `withVeterinaryAnimalAccess`. Use
       * `requireVeterinaryAnimal(req)` to access it.
       */
      veterinaryAnimal?: VeterinaryAnimalContext;
      /** Populated by `withPoultryFlock`. Use `requirePoultryFlock(req)` to access it. */
      poultryFlock?: PoultryFlockContext;
      /** Populated by `withSheepBatch`. Use `requireSheepBatch(req)` to access it. */
      sheepBatch?: SheepBatchContext;
      /** Populated by `withCattleBatch`. Use `requireCattleBatch(req)` to access it. */
      cattleBatch?: CattleBatchContext;
      /** Populated by `withProduct`. Use `requireProduct(req)` to access it. */
      product?: ProductContext;
      /** Populated by `withConversation`. Use `requireConversation(req)` to access it. */
      conversation?: ConversationContext;
      /** Populated by `withPoultryOffer`. Use `requirePoultryOffer(req)` to access it. */
      poultryOffer?: PoultryOfferContext;
      /** Populated by `withEggOffer`. Use `requireEggOffer(req)` to access it. */
      eggOffer?: EggOfferContext;
    }
  }
}

export {};
