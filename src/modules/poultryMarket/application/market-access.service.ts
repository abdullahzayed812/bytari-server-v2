import { ForbiddenError } from '../../../shared/errors/app-error.js';
import { ErrorCode } from '../../../shared/errors/error-codes.js';
import type { AuthorizationService } from '../../authorization/authorization.service.js';
import type { AuthPrincipal } from '../../authorization/authorization.types.js';
import {
  combineMarketAccess,
  evaluateFarm,
  evaluateMerchant,
  type MarketAccessDTO,
} from '../domain/market-access.js';
import type { TraderStatus } from '../domain/trader.constants.js';
import type { MarketAccessRepository } from '../infrastructure/market-access.repository.js';
import type { TraderRepository } from '../infrastructure/trader.repository.js';

/** Market oversight permissions — their holders (ADMIN / MARKET supervisors) browse without an account. */
const STAFF_PERMISSIONS = ['market.offer.admin.read', 'market.rate.manage'] as const;

/**
 * THE answer to "may this user use Markets & Exchanges right now, and which
 * sections?" — used by `GET /poultry-market/access` (the app's screen state)
 * AND every protected market route, so the screen and the API never disagree.
 * Re-evaluated from the database on every request (trader profile + owned
 * farms by `owner_user_id`); nothing the client sends identifies an account.
 */
export class MarketAccessService {
  constructor(
    private readonly traders: TraderRepository,
    private readonly access: MarketAccessRepository,
    private readonly authz: AuthorizationService,
  ) {}

  private async isStaff(principal: AuthPrincipal): Promise<boolean> {
    if (this.authz.isAdmin(principal)) return true;
    for (const permission of STAFF_PERMISSIONS) {
      if (await this.authz.can(principal, permission)) return true;
    }
    return false;
  }

  async resolve(principal: AuthPrincipal): Promise<MarketAccessDTO> {
    const [profile, farms, staff] = await Promise.all([
      this.traders.findByUserId(principal.userId),
      this.access.listOwnedPoultryFarms(principal.userId),
      this.isStaff(principal),
    ]);
    const traderStatus = (principal.traderStatus ?? 'NOT_REGISTERED') as TraderStatus;
    return combineMarketAccess(
      evaluateMerchant(traderStatus, profile),
      farms.map((f) => evaluateFarm(f)),
      staff,
    );
  }

  /** Browse the markets / bourses / statistics. */
  async assertMarkets(principal: AuthPrincipal): Promise<MarketAccessDTO> {
    const access = await this.resolve(principal);
    if (!access.sections.markets) throw this.denied(access);
    return access;
  }

  /** Publish / manage own sale offers — needs an eligible merchant OR poultry farm account. */
  async assertSell(principal: AuthPrincipal): Promise<MarketAccessDTO> {
    const access = await this.resolve(principal);
    if (!access.sections.sell) throw this.denied(access);
    return access;
  }

  /**
   * The most specific reason: an expired merchant keeps the existing
   * `TRADER_SUBSCRIPTION_EXPIRED`; an expired / not-yet-active farm gets
   * `FARM_SUBSCRIPTION_NOT_ACTIVE`; otherwise there is simply no eligible
   * account (`MARKET_ACCOUNT_REQUIRED`).
   */
  private denied(access: MarketAccessDTO): ForbiddenError {
    const details = [
      { path: 'merchant', message: access.merchant.reason },
      ...access.farms.map((f) => ({ path: `farms.${f.organizationId}`, message: f.reason })),
    ];
    if (access.merchant.reason === 'SUBSCRIPTION_EXPIRED') {
      return new ForbiddenError(
        'Your trader activation period has ended — request a renewal to use the market',
        { code: ErrorCode.TRADER_SUBSCRIPTION_EXPIRED, details },
      );
    }
    if (
      access.farms.some(
        (f) => f.reason === 'SUBSCRIPTION_EXPIRED' || f.reason === 'SUBSCRIPTION_NOT_STARTED',
      )
    ) {
      return new ForbiddenError(
        'Your poultry farm subscription is not active — renew it to use the market',
        { code: ErrorCode.FARM_SUBSCRIPTION_NOT_ACTIVE, details },
      );
    }
    return new ForbiddenError(
      'Markets & Exchanges require an active merchant account or an active poultry farm',
      { code: ErrorCode.MARKET_ACCOUNT_REQUIRED, details },
    );
  }
}
