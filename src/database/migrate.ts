/**
 * Programmatic migration / seed runner.
 *
 * Used by both dev (`tsx src/database/migrate.ts <cmd>`) and production
 * (`node dist/database/migrate.js <cmd>`), so no `ts-node`/`tsx` or a
 * TypeScript knexfile is required inside the production image.
 *
 * Commands: latest | rollback | status | seed | reset
 *
 *   reset — DESTRUCTIVE. Drops the whole `public` schema (every table, type and
 *   the migration ledger), recreates it, re-runs every migration, then runs the
 *   base seeds. Refused when `NODE_ENV=production`. For a full local dataset,
 *   `npm run db:reset:dev` chains the persona dev-seed after it.
 *
 * When `NODE_ENV=test`, loads `.env.test` (same convention as `test/setup.ts`)
 * so `npm test` migrates the separate test database, never the dev one —
 * integration tests TRUNCATE `users` between runs (test/helpers/db.ts).
 */
import { existsSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import { loadConfig } from '../config/index.js';
import { createLogger } from '../shared/logger/index.js';
import { createKnex } from './knex.js';

if (process.env.NODE_ENV === 'test' && existsSync('.env.test')) {
  loadDotenv({ path: '.env.test' });
}

type Command = 'latest' | 'rollback' | 'status' | 'seed' | 'reset';

const COMMANDS: readonly Command[] = ['latest', 'rollback', 'status', 'seed', 'reset'];

function parseCommand(raw: string | undefined): Command {
  const value = (raw ?? 'latest') as Command;
  if (!COMMANDS.includes(value)) {
    throw new Error(`Unknown command "${raw}". Expected one of: ${COMMANDS.join(', ')}`);
  }
  return value;
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv[2]);
  const config = loadConfig();
  const logger = createLogger(config);
  const db = createKnex(config);

  try {
    switch (command) {
      case 'latest': {
        const [batch, applied] = (await db.migrate.latest()) as [number, string[]];
        logger.info(
          { batch, applied },
          applied.length ? `Applied ${applied.length} migration(s)` : 'Database already up to date',
        );
        break;
      }
      case 'rollback': {
        const [batch, reverted] = (await db.migrate.rollback()) as [number, string[]];
        logger.info(
          { batch, reverted },
          reverted.length ? `Rolled back ${reverted.length} migration(s)` : 'Nothing to roll back',
        );
        break;
      }
      case 'status': {
        const version = await db.migrate.currentVersion();
        logger.info({ version }, `Current migration version: ${version}`);
        break;
      }
      case 'seed': {
        const [executed] = await db.seed.run();
        logger.info({ executed }, `Executed ${executed.length} seed file(s)`);
        break;
      }
      case 'reset': {
        if (config.isProduction) {
          throw new Error('`reset` is refused when NODE_ENV=production — it drops every table.');
        }
        const target = config.database.url
          ? config.database.url.replace(/:\/\/[^@]*@/, '://***@')
          : `${config.database.host}:${config.database.port}/${config.database.name}`;
        logger.warn({ target }, 'reset: dropping and recreating the entire "public" schema');

        // One statement: CASCADE takes every table, sequence, type, view and the
        // knex_migrations ledger with it. Then restore the stock grants so the
        // connecting role (and later migrations) can create objects again.
        await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
        await db.raw('CREATE SCHEMA public');
        await db.raw('GRANT ALL ON SCHEMA public TO CURRENT_USER');
        await db.raw('GRANT ALL ON SCHEMA public TO public');

        const [batch, applied] = (await db.migrate.latest()) as [number, string[]];
        logger.info({ batch, count: applied.length }, `reset: applied ${applied.length} migration(s)`);

        const [executed] = await db.seed.run();
        logger.info(
          { executed },
          `reset: executed ${executed.length} seed file(s) — database rebuilt`,
        );
        break;
      }
    }
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
