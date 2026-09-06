import type { Knex } from 'knex';
import {
  rowToExchangeRate,
  type EggRateEntryInput,
  type MarketExchangeRateRecord,
  type MarketExchangeRateRow,
  type PoultryRateEntryInput,
} from '../domain/exchange-rate.types.js';
import type { MarketBoard } from '../domain/exchange-rate.constants.js';

const TABLE = 'market_exchange_rates';

export class ExchangeRateRepository {
  constructor(private readonly db: Knex) {}

  private conn(trx?: Knex.Transaction): Knex | Knex.Transaction {
    return trx ?? this.db;
  }

  /** Bulk upsert one day's rows for a board (conflict target: board+governorate+date). */
  async upsertMany(
    board: MarketBoard,
    rateDate: string,
    entries: Array<PoultryRateEntryInput | EggRateEntryInput>,
    recordedByUserId: string,
    trx: Knex.Transaction,
  ): Promise<void> {
    for (const entry of entries) {
      const values =
        board === 'POULTRY'
          ? {
              meat_price_per_kg: (entry as PoultryRateEntryInput).meatPricePerKg ?? null,
              layer_price_per_bird: (entry as PoultryRateEntryInput).layerPricePerBird ?? null,
              egg_price_per_tray: null,
            }
          : {
              meat_price_per_kg: null,
              layer_price_per_bird: null,
              egg_price_per_tray: (entry as EggRateEntryInput).eggPricePerTray ?? null,
            };

      await trx(TABLE)
        .insert({
          board,
          governorate: entry.governorate,
          rate_date: rateDate,
          recorded_by_user_id: recordedByUserId,
          ...values,
        })
        .onConflict(['board', 'governorate', 'rate_date'])
        .merge({ ...values, recorded_by_user_id: recordedByUserId, updated_at: new Date() });
    }
  }

  async getForDate(
    board: MarketBoard,
    rateDate: string,
    trx?: Knex.Transaction,
  ): Promise<MarketExchangeRateRecord[]> {
    const rows: MarketExchangeRateRow[] = await this.conn(trx)<MarketExchangeRateRow>(TABLE).where({
      board,
      rate_date: rateDate,
    });
    return rows.map(rowToExchangeRate);
  }

  /**
   * Most recent prior entry per governorate, strictly before `beforeDate` — used
   * to compute the UP/DOWN/FLAT trend. Uses `DISTINCT ON` (Postgres) to get one
   * row per governorate in a single query.
   */
  async getPreviousByGovernorate(
    board: MarketBoard,
    beforeDate: string,
    trx?: Knex.Transaction,
  ): Promise<Map<string, MarketExchangeRateRecord>> {
    const rows: MarketExchangeRateRow[] = await this.conn(trx)
      .raw(
        `SELECT DISTINCT ON (governorate) *
           FROM ${TABLE}
          WHERE board = ? AND rate_date < ?
          ORDER BY governorate, rate_date DESC`,
        [board, beforeDate],
      )
      .then((result: { rows: MarketExchangeRateRow[] }) => result.rows);

    const map = new Map<string, MarketExchangeRateRecord>();
    for (const row of rows) map.set(row.governorate, rowToExchangeRate(row));
    return map;
  }
}
