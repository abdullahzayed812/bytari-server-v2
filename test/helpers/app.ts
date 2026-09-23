import type { Express } from 'express';
import { pino } from 'pino';
import { loadConfig } from '../../src/config/index.js';
import { createContainer, type Container, type ContainerDeps } from '../../src/container.js';
import { createApp } from '../../src/app.js';
import { NoopEmailProvider } from '../../src/infra/email/index.js';
import { getTestDb } from './db.js';

const logger = pino({ level: 'silent' });

export interface TestHarness {
  app: Express;
  container: Container;
}

export type TestHarnessOverrides = Pick<
  ContainerDeps,
  'aiResponder' | 'objectStorage' | 'pushProvider' | 'emailProvider'
>;

/**
 * Maps a built test app back to the container that built it, so shared
 * factory helpers (`registerUser`, `verifyEmail`, …) that only receive `app`
 * — matching the ~85 existing test files' call sites, none of which need to
 * change — can still reach `container.emailProvider` (a `NoopEmailProvider`
 * in every test run, since `.env.test` never sets `EMAIL_USER`/`EMAIL_PASS`)
 * to read back the verification code a registration/resend just "sent".
 */
const containersByApp = new WeakMap<Express, Container>();

/** The container `buildTestApp()` built `app` with. Throws if `app` wasn't built here. */
export function containerFor(app: Express): Container {
  const container = containersByApp.get(app);
  if (!container) {
    throw new Error('containerFor(app): this app was not created by buildTestApp()');
  }
  return container;
}

/**
 * Build a real app wired to the shared test database.
 *
 * `emailProvider` defaults to an explicit `NoopEmailProvider` — NOT whatever
 * `createEmailProvider(config, …)` would auto-select from the environment.
 * A developer's local `.env` commonly carries real Gmail credentials (for
 * manual `npm run dev` testing); without this override, any test suite run
 * on such a machine would silently try to send REAL email through the real
 * `GmailEmailProvider` (and `registerUser()`'s auto-verify — see
 * `factories.ts` — would fail outright, since that provider has no `.sent`
 * capture to read the code back from). Pass `{ emailProvider: ... }` to opt
 * into a different double.
 */
export function buildTestApp(overrides: TestHarnessOverrides = {}): TestHarness {
  const config = loadConfig();
  const db = getTestDb();
  const container = createContainer({
    db,
    config,
    logger,
    emailProvider: new NoopEmailProvider(logger),
    ...overrides,
  });
  const app = createApp({ config, db, logger, container });
  containersByApp.set(app, container);
  return { app, container };
}
