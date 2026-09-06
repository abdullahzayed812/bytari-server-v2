import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { EventBus } from '../../../shared/events/index.js';
import { AuditAction, AuditEntityType, type AuditContext } from '../../audit/audit.types.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { MarketBoard } from '../domain/exchange-rate.constants.js';
import {
  toEggRateEntry,
  toPoultryRateEntry,
  type EggRateEntry,
  type EggRateEntryInput,
  type MarketExchangeRateRecord,
  type PoultryRateEntry,
  type PoultryRateEntryInput,
} from '../domain/exchange-rate.types.js';
import type { ExchangeRateRepository } from '../infrastructure/exchange-rate.repository.js';

export interface MarketActor {
  actorUserId: string;
  context?: AuditContext;
}

/**
 * Daily governorate price boards ("bourse"). One shared table/service for
 * both conceptual boards (POULTRY / EGG) — identical entry/view/trend
 * workflow, only the value-column count differs. See migration
 * `20260917040000_market_exchange_rates.ts` for the schema rationale.
 */
export class ExchangeRateService {
  private readonly log: Logger;

  constructor(
    private readonly db: Knex,
    private readonly rates: ExchangeRateRepository,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.child({ component: 'exchange-rate-service' });
  }

  async savePoultry(
    rateDate: string,
    entries: PoultryRateEntryInput[],
    actor: MarketActor,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.rates.upsertMany('POULTRY', rateDate, entries, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: AuditAction.MARKET_EXCHANGE_RATES_SAVED,
          entityType: AuditEntityType.MARKET_EXCHANGE_RATE,
          entityId: null,
          actorUserId: actor.actorUserId,
          metadata: { board: 'POULTRY', rateDate, governorates: entries.map((e) => e.governorate) },
          context: actor.context,
        },
        tx,
      );
    });
    this.events.publish('market-exchange-rates.saved', { board: 'POULTRY', rateDate });
  }

  async saveEgg(rateDate: string, entries: EggRateEntryInput[], actor: MarketActor): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.rates.upsertMany('EGG', rateDate, entries, actor.actorUserId, tx);
      await this.audit.record(
        {
          action: AuditAction.MARKET_EXCHANGE_RATES_SAVED,
          entityType: AuditEntityType.MARKET_EXCHANGE_RATE,
          entityId: null,
          actorUserId: actor.actorUserId,
          metadata: { board: 'EGG', rateDate, governorates: entries.map((e) => e.governorate) },
          context: actor.context,
        },
        tx,
      );
    });
    this.events.publish('market-exchange-rates.saved', { board: 'EGG', rateDate });
  }

  private async previousMap(
    board: MarketBoard,
    rateDate: string,
  ): Promise<Map<string, MarketExchangeRateRecord>> {
    return this.rates.getPreviousByGovernorate(board, rateDate);
  }

  async getPoultry(rateDate: string): Promise<PoultryRateEntry[]> {
    const [current, previous] = await Promise.all([
      this.rates.getForDate('POULTRY', rateDate),
      this.previousMap('POULTRY', rateDate),
    ]);
    return current.map((c) => toPoultryRateEntry(c, previous.get(c.governorate) ?? null));
  }

  async getEgg(rateDate: string): Promise<EggRateEntry[]> {
    const [current, previous] = await Promise.all([
      this.rates.getForDate('EGG', rateDate),
      this.previousMap('EGG', rateDate),
    ]);
    return current.map((c) => toEggRateEntry(c, previous.get(c.governorate) ?? null));
  }
}
